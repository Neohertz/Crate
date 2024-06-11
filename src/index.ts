import Sift from "@rbxts/sift";

/**
 * Rewrite of my prior crate package to be more useful.
 */

type Middleware<T> = (oldValue: T[keyof T], newValue: T[keyof T]) => T[keyof T];

interface ExplodedPromise {
	method: () => Promise<unknown>;
	resolve: (v: unknown) => void;
	reject: (e: string) => void;
}

export class Crate<T extends object> {
	private state: T;
	private defaultState: T;
	private events: Set<RBXScriptConnection>;
	private updateBind: BindableEvent<(val: T) => void>;
	private middlewareMethods: Map<string, Middleware<T>>;

	// Queue
	private queue: Array<ExplodedPromise>;
	private queueInProgress: boolean;

	constructor(state: T) {
		this.queue = new Array();
		this.queueInProgress = false;

		this.middlewareMethods = new Map();
		this.updateBind = new Instance("BindableEvent", script);
		this.events = new Set();
		this.state = state;
		this.defaultState = Sift.Dictionary.copyDeep(state);
	}

	//// PUBLIC API ////

	/**
	 * Apply middleware to the crate, mutating keys before final
	 * `oldValue` is the value prior to the `set` method.
	 * `newValue` is the expected value to be set.
	 *
	 * @param key
	 * @param middleware
	 */
	useMiddleware<K extends keyof T>(key: K, middleware: Middleware<T>) {
		this.middlewareMethods.set(key as string, middleware);
	}

	async update(data: Partial<Record<keyof T, T[keyof T] | ((old: T[keyof T]) => T[keyof T])>>) {
		return this.enqueue(async () => {
			for (const [k, v] of Sift.Dictionary.entries(data)) {
				// Check for mutator function
				if (typeIs(v, "function")) {
					data[k] = v(this.state[k]);
				}

				// Check for middleware
				if (this.middlewareMethods.has(k as string)) {
					// HACK: we need to cast data[k] even though it will always be a value
					data[k] = this.executeMiddleware(k, this.state[k], data[k] as T[keyof T]);
				}
			}

			this.state = { ...this.state, ...data };
			this.updateBind.Fire(this.state);
		});
	}

	/**
	 * Bind a callback that is invoked whenever the state changes.
	 */
	onUpdate(cb: (data: T) => void) {
		this.events.add(this.updateBind.Event.Connect(cb));
	}

	/**
	 * Get a reference to the datastore object.
	 */
	get(): T;
	/**
	 * Get the value of a specific key in the datastore.
	 * @param key
	 */
	get(key: keyof T): T[typeof key];
	get(key?: keyof T) {
		if (key !== undefined) {
			return this.state[key];
		} else {
			return this.state;
		}
	}

	/**
	 * Reset the state back to the default.
	 */
	reset() {
		this.enqueue(async () => {
			this.state = Sift.Dictionary.copyDeep(this.defaultState);
		});
	}

	/**
	 * Delete the crate.
	 */
	destroy() {
		this.events.forEach((v) => v.Disconnect());
	}

	//// PRIVATE API ////

	/**
	 * Execute middleware with tests.
	 * @param key
	 * @param oldValue
	 * @param newValue
	 * @returns
	 */
	private executeMiddleware(key: keyof T, oldValue: T[keyof T], newValue: T[keyof T]): T[keyof T] {
		const MW_EXEC_TIME = tick();

		const Method = this.middlewareMethods.get(key as string);
		const Result = Method !== undefined ? Method(oldValue, newValue) : newValue;

		if (tick() - MW_EXEC_TIME > 0.2)
			warn("[Crate] Yeilding is prohibited within middleware to prevent unexpected behavior.");

		return Result;
	}

	/**
	 * Recursive method to step the internal function queue.
	 * @param recurse
	 * @returns
	 */
	private stepQueue(recurse = false) {
		if (this.queueInProgress && !recurse) {
			return;
		}

		this.queueInProgress = true;

		if (this.queue.size() > 0) {
			const { method, resolve, reject } = this.queue.shift()!;

			method()
				.then((result) => resolve(result))
				.catch((reason) => reject(reason))
				.finally(() => this.stepQueue(true));
		} else {
			this.queueInProgress = false;
		}
	}

	/**
	 * Internal wrapper for enqueuing async functions.
	 * @param cb
	 * @returns
	 */
	private async enqueue<T>(cb: () => Promise<T>): Promise<T> {
		return new Promise((res, rej) => {
			this.queue.push({
				method: cb,
				resolve: res as (v: unknown) => void,
				reject: rej,
			});

			this.stepQueue();
		});
	}
}
