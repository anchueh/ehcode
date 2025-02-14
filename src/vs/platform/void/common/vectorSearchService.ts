/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../platform/ipc/common/mainProcessService.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';

export interface IVectorSearchService {
	readonly _serviceBrand: undefined;
	search(query: string, collectionName: string, limit?: number): Promise<SearchResult[]>;
}

export interface SearchResult {
	id: string;
	score: number;
	payload: any;
}

export const IVectorSearchService = createDecorator<IVectorSearchService>('vectorSearchService');

export class VectorSearchService implements IVectorSearchService {
	declare readonly _serviceBrand: undefined;
	private readonly channel: IChannel;
	private readonly DEFAULT_LIMIT = 5;
	private readonly DEFAULT_SCORE_THRESHOLD = 0.5;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
	) {
		this.channel = mainProcessService.getChannel('void-channel-vector-search');
	}

	async search(query: string, collectionName: string, limit = this.DEFAULT_LIMIT): Promise<SearchResult[]> {
		try {
			const settings = this.voidSettingsService.state.settingsOfProvider;
			const results = await this.channel.call('search', {
				query,
				collectionName,
				limit,
				score_threshold: this.DEFAULT_SCORE_THRESHOLD,
				with_payload: true,
				settings,
			}) as SearchResult[];

			return results;
		} catch (error) {
			console.error('Vector search error:', error);
			throw error;
		}
	}
}

registerSingleton(IVectorSearchService, VectorSearchService, InstantiationType.Eager);
