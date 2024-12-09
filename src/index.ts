/**
 * @rbxts/crate
 *
 * The small, yet powerful state manager for roblox-ts.
 */

import Signal from "@rbxts/lemon-signal";
import Sift, { Dictionary } from "@rbxts/sift";
import { ReadonlyDeep } from "@rbxts/sift/out/Util";

type ValueOrMutator<T> = { [K in keyof T]?: (T[K] extends object ? ValueOrMutator<T[K]> : T[K]) | ((v: T[K]) => T[K]) };
type PartialDeep<T> = { [K in keyof T]?: T[K] extends object ? PartialDeep<T[K]> : T[K] };

interface ExplodedPromise {
	method: () => Promise<unknown>;
	resolve: (v: unknown) => void;
	reject: (e: string) => void;
}

// Deep Readonly Types
type DeepReadonly<T> = T extends (infer R)[]
	? DeepReadonlyArray<R>
	: T extends Callback
		? T
		: T extends object
			? DeepReadonlyObject<T>
			: T;

interface DeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> {}

type DeepReadonlyObject<T> = {
	readonly [P in keyof T]: DeepReadonly<T[P]>;
};

type Selector<T, K> = (state: T) => K;

export class Crate<T extends object> {
	private state: T;
	private enabled: boolean;

	// Signals
	private updateSignal = new Signal<(selectorAdress: string, data: unknown) => void>();
	private keyUpdateBind = new Signal<(key: keyof T, value: T[keyof T]) => void>();
	private diffSignal = new Signal<(diff: PartialDeep<T>) => void>();

	// Maps
	private events = new Set<RBXScriptConnection>();
	private middlewareMethods = new Map<string, Callback>();
	private updateSelectors = new Set<Selector<T, unknown>>();

	// Queue
	private queue: Array<ExplodedPromise>;
	private queueInProgress: boolean;

	constructor(state: T) {
		this.enabled = true;
		this.queue = new Array();
		this.queueInProgress = false;
		this.state = state;
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
	useMiddleware<K extends keyof T>(key: K, middleware: (oldValue: T[K], newValue: T[K]) => T[K]): void {
		this.middlewareMethods.set(key as string, middleware);
	}

	/**
	 * Bind a callback that receives the diff from any state updates.
	 * Very useful for replicating state efficiently to the client. On the client,
	 * simply call `clientCrate.update()` on the received state to merge it.
	 *
	 * ## Important Information
	 * - Diff generation favors [k, v] pairs. Standard arrays undergo a shallow equality check, and if that check fails the entire array is pushed to the diff.
	 * - Callback will be invoked **after** the state is updated.
	 *
	 * @param executor (diff: PartialDeep<T>) => void
	 * @returns RBXScriptConnection
	 */
	useDiff(executor: (diff: PartialDeep<T>) => void): RBXScriptConnection {
		return this.diffSignal.Connect(executor);
	}

	/**
	 * Update the crate state with a partial object. Under the hood, crate generates a diff that can be consumed with `useDiff()`.
	 *
	 * `update` also takes in a second parameter that, when true, will deep clone the passed object. [See Issue #1](https://github.com/Neohertz/crate/issues/1)
	 *
	 * All update calls are queued internally.
	 *
	 * ```ts
	 * // set
	 * crate.update({
	 * 	coins: 10
	 * })
	 * // or increment/mutate
	 * crate.update({
	 * 	coins: (v) => v + 10
	 * })
	 * ```
	 *
	 * @param data Partial<VorM<T>>
	 * @param copy boolean
	 * @returns
	 */
	async update(data: Partial<ValueOrMutator<T>>, copy = false): Promise<void> {
		assert(this.enabled, "[Crate] Attempted to update crate state after calling cleanup().");

		// Deep clone the table only if the copy parameter is true.
		if (copy) {
			data = Sift.Dictionary.copyDeep(data);
		}

		const selectorValues = new Map<Selector<T, unknown>, unknown>();
		this.updateSelectors.forEach((selector) => selectorValues.set(selector, selector(this.state)));

		let diff: object = {};
		let pointer: object;

		return this.enqueue(async () => {
			pointer = this.state;

			/**
			 * Recursively validate the state and generate the diff.
			 * @param obj
			 * @param level
			 * @returns boolean
			 */
			const apply = (obj: Record<string, unknown>, level = 0): boolean => {
				let changed = false;

				for (const [key, _value] of pairs(obj)) {
					let value = _value;

					if (typeIs(value, "function")) {
						// Check for mutator function
						value = value(pointer[key as never], level + 1);
					}

					// TODO: implement better middleware.
					if (level === 0) {
						if (this.middlewareMethods.has(key as string)) {
							// Check for middleware
							value = this.executeMiddleware(key as never, this.state[key as never], value as never);
						}
					}

					if (typeIs(value, "table") && !Sift.Array.is(value)) {
						// handle objects

						const currentPointer = pointer;
						const previousDiff = diff;

						diff[key as never] = {} as never;
						diff = diff[key as never];
						pointer = pointer[key as never] as object;

						const changes = apply(value as Record<string, unknown>);

						if (!changes) {
							previousDiff[key as never] = undefined as never;
						} else {
							changed = true;
						}

						diff = previousDiff;
						pointer = currentPointer;

						continue;
					} else if (typeIs(value, "table")) {
						// Handle arrays
						if (!Sift.Array.equals(value, pointer[key as never])) {
							diff[key as never] = value as never;
							obj[key] = value;
							changed = true;
						}
					} else if (pointer[key as never] !== obj[key]) {
						// Handle primitives
						diff[key as never] = value as never;
						obj[key] = value;
						changed = true;
					}
				}

				return changed;
			};

			const hasStateChanged = apply(data);

			this.state = { ...this.state, ...diff };

			if (hasStateChanged) {
				this.diffSignal.Fire(diff);
			}

			for (const selector of this.updateSelectors) {
				const fetch = selectorValues.get(selector);

				if (fetch === undefined) {
					continue;
				}

				const result = selector(this.state);
				let hasChanged = false;

				if (Sift.Array.is(result) && Sift.Array.is(fetch)) {
					hasChanged = !Sift.Array.equals(result, fetch);
				} else if (typeIs(result, "table") && typeIs(fetch, "table")) {
					hasChanged = !Sift.Dictionary.equals(result, fetch);
				} else {
					hasChanged = result !== fetch;
				}

				if (hasChanged) {
					this.updateSignal.Fire(tostring(selector), result);
				}
			}
		});
	}

	/**
	 * Listen for changes on the entire crate.
	 */
	onUpdate(callback: (state: Readonly<T>) => void): RBXScriptConnection;
	onUpdate<K>(selector: Selector<T, K>, callback: (state: ReadonlyDeep<K>) => void): RBXScriptConnection;
	onUpdate<K>(selectorOrCallback: unknown, possibleCallback?: unknown): RBXScriptConnection {
		const selector = (possibleCallback === undefined ? (result: T): T => result : selectorOrCallback) as Selector<
			T,
			K
		>;

		const callback = (possibleCallback ?? selectorOrCallback) as (state: unknown) => void;

		this.updateSelectors.add(selector);
		const connection = this.updateSignal.Connect((sel, val) => {
			if (sel === tostring(selector)) {
				callback(val as unknown);
			}
		});

		return connection;
	}

	/**
	 * Get a frozen reference to the crate's internal state.
	 */
	getState(): Readonly<T>;
	/**
	 * Get the value of a specific key in the crate's state.
	 * @param key shallow key within crate
	 */
	getState<K extends keyof T>(key: K): Readonly<T[K]>;
	/**
	 * Retrieve a value via a selector function.
	 * @param selector `(state: T) => K`
	 */
	getState<K>(selector: Selector<T, K>): Readonly<K>;
	getState<K>(key?: keyof T | Selector<T, K>): unknown {
		assert(this.enabled, "[Crate] Attempted to fetch crate state after calling cleanup().");
		let result: unknown;

		if (key !== undefined) {
			result = typeIs(key, "function") ? key(this.state) : this.state[key];
			return typeIs(result, "table") ? result : result;
		} else {
			return table.freeze(Sift.Dictionary.copyDeep(this.state));
		}
	}

	/**
	 * Cleanup the crate's internal connections.
	 *
	 * Calling this method will cause future `update()` calls to error.
	 */
	cleanup(): void {
		this.enabled = false;
		this.events.forEach((event) => event?.Disconnect());
		this.updateSignal.Destroy();
		this.keyUpdateBind.Destroy();
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

		const method = this.middlewareMethods.get(key as string) as Callback;
		const result = method !== undefined ? method(oldValue, newValue) : newValue;

		if (tick() - MW_EXEC_TIME > 0.2) {
			warn("[Crate] Yielding is prohibited within middleware to prevent unexpected behavior.");
		}

		return result;
	}

	/**
	 * Recursive method to step the internal function queue.
	 * @param recurse
	 * @returns
	 */
	private stepQueue(recurse = false): void {
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
