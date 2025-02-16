/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';

export interface SearchParams {
	query: string;
	collectionNames: string[];
	limit: number;
	score_threshold: number;
	with_payload: boolean;
}

export interface SearchResult {
	id: string;
	score: number;
	payload: any;
	collection?: string; // Added to track which collection the result came from
}

export class VectorSearchMainService implements IServerChannel {
	private client: QdrantClient | undefined;
	private readonly _onSearchResult = new Emitter<SearchResult[]>();
	private readonly EMBEDDING_MODEL = 'text-embedding-3-small';
	private readonly VECTOR_SIZE = 1536;
	private readonly collections = new Set<string>();

	constructor() {
		this.initializeCollections();
	}

	private async initializeCollections() {
		try {
			if (this.client) {
				const collections = await this.client.getCollections();
				collections.collections.forEach(collection => {
					this.collections.add(collection.name);
				});
				console.log('Available collections:', Array.from(this.collections));
			}
		} catch (error) {
			console.error('Failed to initialize collections:', error);
		}
	}

	listen(_: unknown, event: string): Event<any> {
		if (event === 'onSearchResult') {
			return this._onSearchResult.event;
		}
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, args: any): Promise<any> {
		try {
			if (command === 'search') {
				const params = args as SearchParams;
				const settings = args.settings;

				if (!settings?.openAI?._didFillInProviderSettings) {
					throw new Error('OpenAI settings not configured. Please configure OpenAI settings in EH Code Settings.');
				}

				const qdrantUrl = settings.globalSettings.qdrantUrl;
				const qdrantApiKey = settings.globalSettings.qdrantApiKey;

				if (!qdrantUrl || !qdrantApiKey) {
					throw new Error('Qdrant configuration is missing. Please configure Qdrant URL and API Key in Settings > General.');
				}

				if (!this.client) {
					this.client = new QdrantClient({
						url: qdrantUrl,
						apiKey: qdrantApiKey,
					});
				}

				console.log('Search request:', { query: params.query, collections: params.collectionNames });

				// Check if collections exist before proceeding
				const existingCollections = await this.ensureCollectionsExist(params.collectionNames);
				if (existingCollections.length === 0) {
					throw new Error(`None of the requested collections exist in Qdrant.`);
				}

				const openai = new OpenAI({
					baseURL: settings.openAI.endpoint,
					apiKey: settings.openAI.apiKey,
					dangerouslyAllowBrowser: true
				});

				const embedding = await this.getEmbedding(params.query, openai);

				// Search all collections in parallel
				const searchPromises = existingCollections.map(async (collectionName) => {
					if (!this.client) {
						throw new Error('Qdrant client is not initialized');
					}
					const results = await this.client.search(collectionName, {
						vector: embedding,
						limit: params.limit,
						score_threshold: params.score_threshold,
						with_payload: params.with_payload,
					});
					// Add collection name to each result
					return results.map(result => ({ ...result, collection: collectionName }));
				});

				const allResults = await Promise.all(searchPromises);
				const flatResults = allResults.flat();

				console.log('Search results:', {
					query: params.query,
					totalResults: flatResults.length,
					resultsByCollection: existingCollections.reduce((acc, collection) => {
						acc[collection] = flatResults.filter(r => r.collection === collection).length;
						return acc;
					}, {} as Record<string, number>),
					topScores: flatResults.map(r => ({
						score: r.score,
						collection: r.collection,
						payload: r.payload
					}))
				});

				return flatResults;
			}
			throw new Error(`Command not found: ${command}`);
		} catch (error) {
			console.error('VectorSearchMainService error:', error);
			throw error;
		}
	}

	private async getEmbedding(text: string, openai: OpenAI): Promise<number[]> {
		try {
			const response = await openai.embeddings.create({
				model: this.EMBEDDING_MODEL,
				input: text,
			});

			const embedding = response.data[0].embedding;
			if (embedding.length !== this.VECTOR_SIZE) {
				throw new Error(`Unexpected embedding size: ${embedding.length} (expected ${this.VECTOR_SIZE})`);
			}

			return embedding;
		} catch (error) {
			console.error('Error getting embedding:', error);
			throw error;
		}
	}

	private async ensureCollectionsExist(collectionNames: string[]): Promise<string[]> {
		const existingCollections: string[] = [];

		try {
			if (!this.client) {
				throw new Error('Qdrant client is not initialized');
			}
			const collections = await this.client.getCollections();
			const availableCollections = new Set(collections.collections.map(c => c.name));

			for (const name of collectionNames) {
				if (availableCollections.has(name)) {
					existingCollections.push(name);
					this.collections.add(name);
				} else {
					console.warn(`Collection "${name}" does not exist in Qdrant.`);
				}
			}
		} catch (error) {
			console.error(`Failed to check collections:`, error);
		}

		return existingCollections;
	}
}
