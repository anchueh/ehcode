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
	collectionName: string;
	limit: number;
	score_threshold: number;
	with_payload: boolean;
}

export interface SearchResult {
	id: string;
	score: number;
	payload: any;
}

export class VectorSearchMainService implements IServerChannel {
	private readonly client: QdrantClient;
	private readonly _onSearchResult = new Emitter<SearchResult[]>();
	private readonly EMBEDDING_MODEL = 'text-embedding-3-small';
	private readonly VECTOR_SIZE = 1536;
	private readonly collections = new Set<string>();

	constructor() {
		const qdrantHost = process.env.QDRANT_HOST || 'localhost';
		const qdrantPort = parseInt(process.env.QDRANT_PORT || '6333', 10);

		this.client = new QdrantClient({
			url: `http://${qdrantHost}:${qdrantPort}`,
		});

		// Initialize collections cache
		this.initializeCollections();
	}

	private async initializeCollections() {
		try {
			const collections = await this.client.getCollections();
			collections.collections.forEach(collection => {
				this.collections.add(collection.name);
			});
		} catch (error) {
			console.error('Failed to initialize collections:', error);
		}
	}

	private async ensureCollectionExists(collectionName: string): Promise<boolean> {
		if (this.collections.has(collectionName)) {
			return true;
		}

		try {
			const collections = await this.client.getCollections();
			const exists = collections.collections.some(c => c.name === collectionName);
			if (exists) {
				this.collections.add(collectionName);
			}
			return exists;
		} catch (error) {
			console.error(`Failed to check collection ${collectionName}:`, error);
			return false;
		}
	}

	listen(_: unknown, event: string): Event<any> {
		if (event === 'onSearchResult') {
			return this._onSearchResult.event;
		}
		throw new Error(`Event not found: ${event}`);
	}

	private async getEmbedding(text: string, settings: any): Promise<number[]> {
		try {
			if (!settings.openAI?._didFillInProviderSettings) {
				throw new Error('OpenAI settings not configured. Please configure OpenAI settings in Void Settings.');
			}

			const openai = new OpenAI({
				baseURL: settings.openAI.endpoint,
				apiKey: settings.openAI.apiKey,
				dangerouslyAllowBrowser: true
			});

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

	async call(_: unknown, command: string, args: any): Promise<any> {
		try {
			if (command === 'search') {
				const params = args as SearchParams;

				// Check if collection exists before proceeding
				const collectionExists = await this.ensureCollectionExists(params.collectionName);
				if (!collectionExists) {
					throw new Error(`Collection "${params.collectionName}" does not exist in Qdrant.`);
				}

				const embedding = await this.getEmbedding(params.query, args.settings);

				const results = await this.client.search(params.collectionName, {
					vector: embedding,
					limit: params.limit,
					score_threshold: params.score_threshold,
					with_payload: params.with_payload,
				});
				return results;
			}
			throw new Error(`Command not found: ${command}`);
		} catch (error) {
			console.error('VectorSearchMainService error:', error);
			throw error;
		}
	}
}
