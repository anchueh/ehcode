declare module '@qdrant/js-client-rest' {
	export interface QdrantCollection {
		name: string;
		vectors_count?: number;
		points_count?: number;
		status?: string;
	}

	export interface CollectionsResponse {
		collections: QdrantCollection[];
		time: number;
	}

	export interface QdrantClient {
		search(collectionName: string, params: {
			vector: number[];
			limit?: number;
			score_threshold?: number;
			with_payload?: boolean;
		}): Promise<Array<{
			id: string;
			score: number;
			payload: any;
		}>>;

		getCollections(): Promise<CollectionsResponse>;

		createCollection(name: string, params: {
			vectors: {
				size: number;
				distance: "Cosine" | "Euclid" | "Dot";
			};
		}): Promise<void>;
	}

	export class QdrantClient {
		constructor(config: { url: string; apiKey?: string });
	}
}
