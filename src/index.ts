/**
 * @rbxts/crate
 *
 * The small, yet powerful state manager for roblox-ts.
 */

import Signal from "@rbxts/lemon-signal";
import Sift from "@rbxts/sift";
import { entries } from "@rbxts/sift/out/Dictionary";
import { ReadonlyDeep } from "@rbxts/sift/out/Util";

interface ExplodedPromise {
	method: () => Promise<unknown>;
	resolve: (v: unknown) => void;
	reject: (e: string) => void;
}

type IsObjectStaticallyTyped<T extends object> = string extends keyof T ? true : false;

type Transformer<T> = (v: T) => T;

/**
 * Now prevents "partial" state updates to non-static types. Must go through transformer.
 */
type ValueOrTransformer<T> = {
	[K in keyof T]?:
		| (T[K] extends object ? (IsObjectStaticallyTyped<T[K]> extends true ? never : ValueOrTransformer<T[K]>) : T[K])
		| Transformer<T[K]>;
};

type PartialDeep<T> = { [K in keyof T]?: T[K] extends object ? PartialDeep<T[K]> : T[K] };
type Selector<T, K> = (state: T) => K;

// Exported Types
export type InferCrateType<T> = T extends Crate<infer K> ? K : never;
export type CrateDiff<T> = PartialDeep<T>;

// Crate Export
export class Crate<T extends object> {
	private state: T;
	private enabled: boolean;

	// Signals
	private updateSignal = new Signal<(selectorAddress: string, data: unknown) => void>();
	private keyUpdateBind = new Signal<(key: keyof T, value: T[keyof T]) => void>();
	private diffSignal = new Signal<(diff: CrateDiff<T>) => void>();

	// Maps
	private events = new Set<RBXScriptConnection>();
	private middlewareMethods = new Map<string, Callback>();
	private updateSelectors = new Set<Selector<T, unknown>>();

	// Queue
	private queue: Array<ExplodedPromise>;
	private queueInProgress: boolean;

	/**
	 * Create a new crate with a default value.
	 * @param initialState initial state
	 */
	public constructor(initialState: T) {
		this.enabled = true;
		this.queue = new Array();
		this.queueInProgress = false;
		this.state = Sift.Dictionary.copyDeep(initialState);
	}

	// STATIC METHODS //////////////////////////////////////

	/**
	 * Reconcile an object with a crate diff. Useful for integrating the state with other state systems like reflex.
	 * @param state object<T>
	 * @param diff CrateDiff<T>
	 * @returns T
	 */
	public static reconcileDiff<T extends object>(state: T, diff: PartialDeep<T>): T {
		const result = Sift.Dictionary.copyDeep(state);
		let pointer = result;

		const merge = (object: PartialDeep<T>): void => {
			for (const [key, value] of entries(object)) {
				if (typeIs(value, "table") && !Sift.Array.is(value)) {
					const lastPointer = pointer;

					pointer = pointer[key] as never;
					merge(value);
					pointer = lastPointer;

					continue;
				}

				pointer[key] = value as never;
			}
		};

		merge(diff);
		return result;
	}

	// PUBLIC API //////////////////////////////////////

	/**
	 * Apply middleware to the crate that mutates the passed value prior to processing.
	 * `oldValue` is the value prior to the `set` method.
	 * `newValue` is the expected value to be set.
	 *
	 * @param key
	 * @param middleware
	 */
	public useMiddleware<K extends keyof T>(key: K, middleware: (oldValue: T[K], newValue: T[K]) => T[K]): void {
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
	 * @param executor (diff: CrateDiff<T>) => void
	 * @returns RBXScriptConnection
	 */
	public useDiff(executor: (diff: CrateDiff<T>) => void): RBXScriptConnection {
		return this.diffSignal.Connect(executor);
	}

	/**
	 * Update the crate state with a partial object. Under the hood, crate generates a diff that can be consumed with `useDiff()`.
	 *
	 * `update` also takes in a second parameter that, when true, will deep clone the passed object. [See Issue #1](https://github.com/Neohertz/crate/issues/1)
	 *
	 * All update calls are queued internally.
	 *
	 * @example
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
	 * @param modifications Partial<VorM<T>>
	 * @param copy boolean
	 * @returns
	 */
	public async update(modifications: Partial<ValueOrTransformer<T>>, copy = false): Promise<void> {
		assert(this.enabled, "[Crate] Attempted to update crate state after calling cleanup().");

		// Deep clone the table only if the copy parameter is true.
		if (copy) {
			modifications = Sift.Dictionary.copyDeep(modifications);
		}

		const selectorValues = new Map<Selector<T, unknown>, unknown>();
		this.updateSelectors.forEach((selector) => selectorValues.set(selector, selector(this.state)));

		let diff: object = {};

		// A pointer that keeps track of our position of the true data when mapping through the passed data.
		let statePointer: object;

		return this.enqueue(async () => {
			statePointer = this.state;

			/**
			 * Recursively validate the state and generate the diff.
			 * @param obj
			 * @param level
			 * @returns boolean
			 */
			const apply = (obj: Record<string, unknown>, level = 0): boolean => {
				let changed = false;
				let tableTransformer = false;

				for (const [key, _value] of pairs(obj)) {
					let value = _value;

					if (typeIs(value, "function")) {
						// Check for transformer function
						value = value(statePointer[key as never]);

						// If a transformer returns a table, always cause an update.
						if (typeIs(value, "table")) {
							tableTransformer = true;
						}
					}

					// TODO: implement better middleware.
					if (level === 0) {
						if (this.middlewareMethods.has(key as string)) {
							// Check for middleware
							value = this.executeMiddleware(key as never, this.state[key as never], value as never);
						}
					}

					/**
					 * In cases where a Transformer function is invoked and returns an object, we must force a state update.
					 */
					if (tableTransformer) {
						diff[key as never] = value as never;
						obj[key] = value;
						statePointer[key as never] = value as never;
						changed = true;
						continue;
					}

					if (
						typeIs(value, "table") &&
						!Sift.Array.is(value) &&
						!this.isArrayTransform(statePointer[key as never], value)
					) {
						/**
						 * Handle updates on tables.
						 */
						const currentPointer = statePointer;
						const previousDiff = diff;

						diff[key as never] = {} as never;
						diff = diff[key as never];
						statePointer = statePointer[key as never] as object;

						let changes = false;

						changes = apply(value as Record<string, unknown>, level + 1);

						if (!changes) {
							previousDiff[key as never] = undefined as never;
						} else {
							changed = true;
						}

						statePointer = currentPointer;
						diff = previousDiff;

						continue;
					} else if (typeIs(value, "table")) {
						// Handle arrays
						if (!Sift.Array.equals(value, statePointer[key as never])) {
							diff[key as never] = value as never;
							obj[key] = value;
							statePointer[key as never] = value as never;
							changed = true;
						}
					} else if (value !== statePointer[key as never]) {
						// Handle primitives
						diff[key as never] = value as never;
						obj[key] = value;
						statePointer[key as never] = value as never;
						changed = true;
					}
				}

				return changed;
			};

			const hasStateChanged = apply(modifications);

			if (hasStateChanged) {
				this.diffSignal.Fire(diff);
			} else {
				return;
			}

			for (const selector of this.updateSelectors) {
				const fetch = selectorValues.get(selector);

				if (fetch === undefined) {
					continue;
				}

				const [success, result] = pcall(() => selector(diff as never));

				if (success && result !== undefined) {
					this.updateSignal.Fire(tostring(selector), selector(this.state));
				}
			}
		});
	}

	/**
	 * Listen for changes on the entire crate.
	 */
	public onUpdate(callback: (state: Readonly<T>) => void): RBXScriptConnection;
	public onUpdate<K>(selector: Selector<T, K>, callback: (state: ReadonlyDeep<K>) => void): RBXScriptConnection;
	public onUpdate<K>(selectorOrCallback: unknown, possibleCallback?: unknown): RBXScriptConnection {
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
	 * Get a frozen reference to the crate's internal state. Calling this without a selector or key will return a **deep copy**.
	 */
	public getState(): Readonly<T>;
	/**
	 * Get the value of a specific key in the crate's state.
	 * @param key shallow key within crate
	 */
	public getState<K extends keyof T>(key: K): Readonly<T[K]>;
	/**
	 * Retrieve a value via a selector function.
	 * @param selector `(state: T) => K`
	 */
	public getState<K>(selector: Selector<T, K>): Readonly<K>;
	public getState<K>(key?: keyof T | Selector<T, K>): unknown {
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
	public cleanup(): void {
		this.enabled = false;
		this.events.forEach((event) => event?.Disconnect());
		this.updateSignal.Destroy();
		this.keyUpdateBind.Destroy();
	}

	//// PRIVATE API ////

	/**
	 * Due to arrays and tables being of the same type, its hard to classify an empty table in lua.
	 * Because of this, objects that are empty can be counted as tables, therefore breaking our logic.
	 * Example: a empty array ({}) to a populated array ({"Apples", "Oranges"}) or vice versa
	 * @param aValue unknown
	 * @param bValue unknown
	 */
	private isArrayTransform(aValue: unknown, bValue: unknown): boolean {
		const isArrayA = Sift.Array.is(aValue);
		const isArrayB = Sift.Array.is(bValue);
		return (isArrayA || isArrayB) && !(isArrayA && isArrayB);
	}

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
