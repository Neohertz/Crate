export interface ExplodedPromise {
	method: () => Promise<unknown>;
	resolve: (v: unknown) => void;
	reject: (e: string) => void;
}

export type ValueOrMutator<T> = {
	[K in keyof T]?: (T[K] extends object ? ValueOrMutator<T[K]> : T[K]) | ((v: T[K]) => T[K]);
};

export type PartialDeep<T> = { [K in keyof T]?: T[K] extends object ? PartialDeep<T[K]> : T[K] };

export type Selector<T, K> = (state: T) => K;
