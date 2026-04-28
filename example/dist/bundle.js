const CLOG_STYLED = Symbol.for("@marianmeres/clog-styled");
const SAFE_COLORS = {
    gray: "#969696",
    grey: "#969696",
    red: "#d26565",
    orange: "#cba14d",
    yellow: "#cba14d",
    green: "#3dc73d",
    teal: "#4dcba1",
    cyan: "#4dcba1",
    blue: "#67afd3",
    purple: "#8e8ed4",
    magenta: "#b080c8",
    pink: "#be5b9d"
};
const AUTO_PALETTE = [
    SAFE_COLORS.gray,
    SAFE_COLORS.red,
    SAFE_COLORS.orange,
    "#8eba36",
    SAFE_COLORS.green,
    SAFE_COLORS.teal,
    SAFE_COLORS.blue,
    SAFE_COLORS.purple,
    SAFE_COLORS.magenta,
    SAFE_COLORS.pink
];
const _autoColorCache = new Map();
function autoColor(namespace) {
    const cached = _autoColorCache.get(namespace);
    if (cached !== undefined) return cached;
    const color = AUTO_PALETTE[strHash(namespace) % AUTO_PALETTE.length];
    _autoColorCache.set(namespace, color);
    return color;
}
function strHash(str) {
    let hash = 0;
    for(let i = 0; i < str.length; i++){
        hash = (hash << 5) - hash + str.charCodeAt(i) | 0;
    }
    return hash >>> 0;
}
const LEVEL_MAP = {
    debug: "DEBUG",
    log: "INFO",
    warn: "WARNING",
    error: "ERROR"
};
const CLOG_SKIP = Symbol.for("@marianmeres/clog-skip");
const CLOG_INSTANCE = Symbol.for("@marianmeres/clog-instance");
const GLOBAL_KEY = Symbol.for("@marianmeres/clog");
const GLOBAL = globalThis[GLOBAL_KEY] ??= {
    hook: undefined,
    writer: undefined,
    jsonOutput: false,
    debug: undefined
};
let _cachedRuntime = null;
function detectRuntime() {
    if (_cachedRuntime !== null) return _cachedRuntime;
    if (typeof window !== "undefined" && window?.document) {
        return _cachedRuntime = "browser";
    }
    if (globalThis.Deno?.version?.deno) return _cachedRuntime = "deno";
    if (globalThis.process?.versions?.node) {
        return _cachedRuntime = "node";
    }
    return _cachedRuntime = "unknown";
}
const CLOG_FRAME_MARKERS = [
    "clog.ts",
    "colors.ts"
];
function isClogFrame(line) {
    return CLOG_FRAME_MARKERS.some((m)=>line.includes(m));
}
function captureStackLines(limit) {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");
    const relevant = [];
    for (const raw of lines){
        const line = raw.trimEnd();
        if (!line) continue;
        if (/^Error(:|$)/.test(line.trim())) continue;
        if (isClogFrame(line)) continue;
        relevant.push(line);
    }
    if (typeof limit === "number" && limit > 0) {
        return relevant.slice(0, limit);
    }
    return relevant;
}
function formatStack(lines) {
    return "\n---\nStack:\n" + lines.map((v)=>"  " + v.trim()).join("\n");
}
function renderNs(ns) {
    if (!ns) return "";
    return ns.split(":").map((s)=>`[${s}]`).join(" ");
}
function _stringifyArgs(args, config) {
    if (!(config?.stringify ?? GLOBAL.stringify)) return args;
    return args.map((arg)=>{
        if (arg === null || arg === undefined) return arg;
        if (typeof arg !== "object") return arg;
        if (arg?.[CLOG_STYLED]) return arg.text;
        try {
            return JSON.stringify(arg);
        } catch  {
            return String(arg);
        }
    });
}
function stringifyValue(arg) {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (typeof arg !== "object") return String(arg);
    if (arg?.[CLOG_STYLED]) return arg.text;
    try {
        return JSON.stringify(arg);
    } catch  {
        return String(arg);
    }
}
function _hasStyledArgs(args) {
    return args.some((arg)=>arg?.[CLOG_STYLED]);
}
function _cleanStyledArgs(args) {
    return args.map((arg)=>arg?.[CLOG_STYLED] ? arg.text : arg);
}
function _processStyledArgs(args) {
    let format = "";
    const values = [];
    for (const arg of args){
        if (arg?.[CLOG_STYLED]) {
            format += `%c${arg.text}%c `;
            values.push(arg.style, "");
        } else if (typeof arg === "string") {
            format += `${arg} `;
        } else {
            format += "%o ";
            values.push(arg);
        }
    }
    return [
        format.trim(),
        values
    ];
}
function firstArgAsString(args, config) {
    if (args.length === 0) return "";
    const concat = config?.concat ?? GLOBAL.concat;
    const stringify = config?.stringify ?? GLOBAL.stringify;
    if (concat || stringify) return stringifyValue(args[0]);
    return String(args[0] ?? "");
}
const CONSOLE_METHOD = {
    DEBUG: "debug",
    INFO: "log",
    WARNING: "warn",
    ERROR: "error"
};
const defaultWriter = (data)=>{
    const { level, namespace, args, timestamp, config, stack } = data;
    const runtime = detectRuntime();
    const consoleMethod = CONSOLE_METHOD[level];
    const nsText = renderNs(namespace);
    const stackStr = stack && stack.length ? formatStack(stack) : null;
    const shouldConcat = config?.concat ?? GLOBAL.concat;
    if (shouldConcat) {
        const stringified = args.map(stringifyValue).join(" ");
        const output = runtime === "browser" ? nsText ? `${nsText} ${stringified}` : stringified : `[${timestamp}] [${level}]${nsText ? ` ${nsText}` : ""} ${stringified}`;
        console[consoleMethod](output, ...stackStr ? [
            stackStr
        ] : []);
        return;
    }
    const processedArgs = _stringifyArgs(args, config);
    const hasStyled = _hasStyledArgs(processedArgs);
    if ((runtime === "browser" || runtime === "deno") && hasStyled) {
        const [content, contentValues] = _processStyledArgs(processedArgs);
        if (runtime === "browser") {
            console[consoleMethod](nsText ? `${nsText} ${content}` : content, ...contentValues, ...stackStr ? [
                stackStr
            ] : []);
        } else {
            const prefix = `[${timestamp}] [${level}]${nsText ? ` ${nsText}` : ""}`;
            console[consoleMethod](`${prefix} ${content}`, ...contentValues, ...stackStr ? [
                stackStr
            ] : []);
        }
        return;
    }
    const cleanedArgs = _cleanStyledArgs(processedArgs);
    if (runtime === "browser") {
        if (nsText) {
            console[consoleMethod](nsText, ...cleanedArgs, ...stackStr ? [
                stackStr
            ] : []);
        } else {
            console[consoleMethod](...cleanedArgs, ...stackStr ? [
                stackStr
            ] : []);
        }
        return;
    }
    const useJson = config?.jsonOutput ?? GLOBAL.jsonOutput;
    if (useJson) {
        const output = {
            timestamp,
            level,
            ...namespace ? {
                namespace
            } : {},
            message: cleanedArgs[0],
            ...data.meta && {
                meta: data.meta
            }
        };
        cleanedArgs.slice(1).forEach((arg, i)=>{
            output[`arg_${i}`] = arg?.stack ?? arg;
        });
        if (stackStr) output.stack = stackStr;
        console[consoleMethod](JSON.stringify(output));
        return;
    }
    const prefix = `[${timestamp}] [${level}]${nsText ? ` ${nsText}` : ""}`.trim();
    console[consoleMethod](prefix, ...cleanedArgs, ...stackStr ? [
        stackStr
    ] : []);
};
const colorWriter = (configuredColor)=>(data)=>{
        const { level, namespace, args, timestamp, config, stack } = data;
        const runtime = detectRuntime();
        if (runtime !== "browser" && runtime !== "deno" || !namespace || (config?.concat ?? GLOBAL.concat)) {
            return defaultWriter(data);
        }
        const color = configuredColor === "auto" ? autoColor(namespace) : configuredColor;
        const processedArgs = _stringifyArgs(args, config);
        const consoleMethod = CONSOLE_METHOD[level];
        const stackStr = stack && stack.length ? formatStack(stack) : null;
        const nsText = renderNs(namespace);
        if (_hasStyledArgs(processedArgs)) {
            const [content, contentValues] = _processStyledArgs(processedArgs);
            if (runtime === "browser") {
                console[consoleMethod](`%c${nsText}%c ${content}`, `color:${color}`, "", ...contentValues, ...stackStr ? [
                    stackStr
                ] : []);
            } else {
                const prefix = `[${timestamp}] [${level}] %c${nsText}%c`;
                console[consoleMethod](`${prefix} ${content}`, `color:${color}`, "", ...contentValues, ...stackStr ? [
                    stackStr
                ] : []);
            }
            return;
        }
        if (runtime === "browser") {
            console[consoleMethod](`%c${nsText}`, `color:${color}`, ...processedArgs, ...stackStr ? [
                stackStr
            ] : []);
        } else {
            const prefix = `[${timestamp}] [${level}] %c${nsText}`;
            console[consoleMethod](prefix, `color:${color}`, ...processedArgs, ...stackStr ? [
                stackStr
            ] : []);
        }
    };
function createClog(namespace, config) {
    const ns = namespace ?? false;
    const _apply = (level, args)=>{
        const clonedArgs = args.slice();
        const getMetaFn = config?.getMeta ?? GLOBAL.getMeta;
        const stacktraceConfig = config?.stacktrace ?? GLOBAL.stacktrace;
        const stack = stacktraceConfig ? captureStackLines(typeof stacktraceConfig === "number" ? stacktraceConfig : undefined) : undefined;
        const data = {
            level: LEVEL_MAP[level],
            namespace: ns,
            args: clonedArgs,
            timestamp: new Date().toISOString(),
            config,
            stack
        };
        if (getMetaFn) {
            let _meta;
            let _metaComputed = false;
            Object.defineProperty(data, "meta", {
                get () {
                    if (!_metaComputed) {
                        _metaComputed = true;
                        try {
                            _meta = getMetaFn();
                        } catch  {
                            _meta = undefined;
                        }
                    }
                    return _meta;
                },
                enumerable: true,
                configurable: true
            });
        }
        const hookResult = GLOBAL.hook?.(data);
        if (hookResult !== CLOG_SKIP) {
            let writer = GLOBAL.writer ?? config?.writer;
            if (!writer && config?.color) writer = colorWriter(config.color);
            writer = writer ?? defaultWriter;
            writer(data);
        }
        return firstArgAsString(clonedArgs, config);
    };
    const logger = (...args)=>_apply("log", args);
    logger.debug = (...args)=>{
        if ((config?.debug ?? GLOBAL.debug) === false) {
            return firstArgAsString(args, config);
        }
        return _apply("debug", args);
    };
    logger.log = (...args)=>_apply("log", args);
    logger.warn = (...args)=>_apply("warn", args);
    logger.error = (...args)=>_apply("error", args);
    Object.defineProperty(logger, "ns", {
        value: ns,
        writable: false
    });
    Object.defineProperty(logger, CLOG_INSTANCE, {
        value: {
            ns,
            config
        },
        enumerable: false,
        writable: false
    });
    return logger;
}
createClog.global = GLOBAL;
createClog.reset = ()=>{
    createClog.global.hook = undefined;
    createClog.global.writer = undefined;
    createClog.global.jsonOutput = false;
    createClog.global.debug = undefined;
    createClog.global.stringify = undefined;
    createClog.global.concat = undefined;
    createClog.global.stacktrace = undefined;
    createClog.global.getMeta = undefined;
};
function withNamespace(logger, namespace) {
    const marker = logger[CLOG_INSTANCE];
    if (marker) {
        const composed = marker.ns ? `${marker.ns}:${namespace}` : namespace;
        return createClog(composed, marker.config);
    }
    const prefix = `[${namespace}]`;
    const wrapped = (...args)=>{
        logger.log(prefix, ...args);
        return String(args[0] ?? "");
    };
    wrapped.debug = (...args)=>{
        logger.debug(prefix, ...args);
        return String(args[0] ?? "");
    };
    wrapped.log = (...args)=>{
        logger.log(prefix, ...args);
        return String(args[0] ?? "");
    };
    wrapped.warn = (...args)=>{
        logger.warn(prefix, ...args);
        return String(args[0] ?? "");
    };
    wrapped.error = (...args)=>{
        logger.error(prefix, ...args);
        return String(args[0] ?? "");
    };
    return wrapped;
}
if (typeof Symbol.dispose === "undefined") {
    Symbol.dispose = Symbol.for("Symbol.dispose");
}
const WILDCARD = "*";
class PubSub {
    #subs = new Map();
    #onError;
    constructor(options){
        this.#onError = options?.onError ?? this.#defaultErrorHandler;
        this.publish = this.publish.bind(this);
        this.subscribe = this.subscribe.bind(this);
        this.subscribeOnce = this.subscribeOnce.bind(this);
        this.subscribeMany = this.subscribeMany.bind(this);
        this.unsubscribe = this.unsubscribe.bind(this);
        this.unsubscribeAll = this.unsubscribeAll.bind(this);
        this.isSubscribed = this.isSubscribed.bind(this);
        this.subscriberCount = this.subscriberCount.bind(this);
        this.hasSubscribers = this.hasSubscribers.bind(this);
        this.topics = this.topics.bind(this);
    }
    #defaultErrorHandler(error, topic, isWildcard) {
        const prefix = isWildcard ? "wildcard subscriber" : "subscriber";
        console.error(`Error in ${prefix} for topic "${topic}":`, error);
    }
    #invoke(cb, data, topic, isWildcard) {
        try {
            const result = cb(data);
            if (result && typeof result.then === "function") {
                result.catch((reason)=>{
                    const err = reason instanceof Error ? reason : new Error(String(reason));
                    this.#onError(err, topic, isWildcard);
                });
            }
        } catch (error) {
            this.#onError(error, topic, isWildcard);
        }
    }
    #makeUnsubscriber(fn) {
        const u = ()=>fn();
        u[Symbol.dispose] = fn;
        return u;
    }
    publish(topic, data) {
        if (topic === WILDCARD) {
            throw new Error(`Cannot publish to wildcard topic "*". "*" is reserved for subscribers; publish to a real topic name instead.`);
        }
        const direct = this.#subs.get(topic);
        const hadDirect = !!direct && direct.size > 0;
        if (direct) {
            for (const cb of [
                ...direct
            ]){
                this.#invoke(cb, data, topic, false);
            }
        }
        const wildcards = this.#subs.get(WILDCARD);
        if (wildcards && wildcards.size > 0) {
            const envelope = {
                event: topic,
                data
            };
            for (const cb of [
                ...wildcards
            ]){
                this.#invoke(cb, envelope, topic, true);
            }
        }
        return hadDirect;
    }
    subscribe(topic, cb) {
        let bucket = this.#subs.get(topic);
        if (!bucket) {
            bucket = new Set();
            this.#subs.set(topic, bucket);
        }
        bucket.add(cb);
        return this.#makeUnsubscriber(()=>{
            this.unsubscribe(topic, cb);
        });
    }
    subscribeOnce(topic, cb) {
        let fired = false;
        const onceWrapper = (data)=>{
            if (fired) return;
            fired = true;
            this.unsubscribe(topic, onceWrapper);
            return cb(data);
        };
        return this.subscribe(topic, onceWrapper);
    }
    subscribeMany(topics, cb) {
        const unsubs = topics.map((t)=>this.subscribe(t, cb));
        return this.#makeUnsubscriber(()=>{
            for (const u of unsubs)u();
        });
    }
    unsubscribe(topic, cb) {
        const bucket = this.#subs.get(topic);
        if (!bucket) return false;
        if (typeof cb === "function") {
            const removed = bucket.delete(cb);
            if (bucket.size === 0) this.#subs.delete(topic);
            return removed;
        }
        return this.#subs.delete(topic);
    }
    unsubscribeAll(topic) {
        if (topic !== undefined) return this.#subs.delete(topic);
        if (this.#subs.size === 0) return false;
        this.#subs.clear();
        return true;
    }
    isSubscribed(topic, cb, considerWildcard = true) {
        if (this.#subs.get(topic)?.has(cb)) return true;
        if (considerWildcard && this.#subs.get(WILDCARD)?.has(cb)) return true;
        return false;
    }
    subscriberCount(topic) {
        if (topic !== undefined) return this.#subs.get(topic)?.size ?? 0;
        let total = 0;
        for (const set of this.#subs.values())total += set.size;
        return total;
    }
    hasSubscribers(topic) {
        return (this.#subs.get(topic)?.size ?? 0) > 0;
    }
    topics() {
        return [
            ...this.#subs.keys()
        ];
    }
    __dump() {
        const out = {};
        for (const [topic, set] of this.#subs.entries()){
            out[topic] = new Set(set);
        }
        return out;
    }
}
function createPubSub(options) {
    return new PubSub(options);
}
class BatchFlusher {
    _flusher;
    #config;
    #items;
    #flushTimer;
    #running;
    #flushing;
    #inFlight;
    #droppedCount;
    #generation;
    #pubsub;
    #logger;
    #getState() {
        return {
            size: this.#items.length,
            isRunning: this.#running,
            isFlushing: this.#flushing
        };
    }
    #notify() {
        this.#pubsub.publish("state", this.#getState());
    }
    constructor(_flusher, config, autostart = true){
        this._flusher = _flusher;
        this.#config = {
            flushIntervalMs: 1_000,
            maxBatchSize: 100,
            strictFlush: false
        };
        this.#items = [];
        this.#running = false;
        this.#flushing = false;
        this.#droppedCount = 0;
        this.#generation = 0;
        this.#pubsub = createPubSub();
        this.#doFlush = async ()=>{
            try {
                await this.flush();
            } catch (e) {
                if (this.#config.strictFlush) {
                    this.#logger.error("flush error (strict mode)", `${e}`);
                } else {
                    this.#logger.warn("flush error ignored", `${e}`);
                }
            }
        };
        this.#scheduleFlush = ()=>{
            const interval = this.#config.flushIntervalMs;
            if (!interval || !this.#running) return;
            this.#flushTimer = setTimeout(async ()=>{
                await this.#doFlush();
                if (this.#running) this.#scheduleFlush();
            }, interval);
        };
        this.#logger = withNamespace(createClog(), "BatchFlusher");
        if (config) this.configure(config);
        if (autostart) this.start();
    }
    get size() {
        return this.#items.length;
    }
    get isRunning() {
        return this.#running;
    }
    get isFlushing() {
        return this.#flushing;
    }
    get droppedCount() {
        return this.#droppedCount;
    }
    add(item) {
        this.#items.push(item);
        this.#logger.debug(`add (size: ${this.#items.length})`);
        this.#applyCap();
        this.#notify();
        const threshold = this.#config.flushThreshold;
        if (threshold && this.#items.length >= threshold) {
            this.#logger.debug(`flushThreshold reached (${threshold}), flushing...`);
            this.#doFlush();
        }
    }
    reset() {
        this.#generation++;
        this.#items = [];
        this.#notify();
    }
    dump() {
        return [
            ...this.#items
        ];
    }
    async flush() {
        if (this.#inFlight) {
            try {
                await this.#inFlight;
            } catch  {}
            return this.flush();
        }
        if (!this.#items.length) {
            this.#logger.debug("flush skipped (empty)");
            return true;
        }
        const items = [
            ...this.#items
        ];
        const gen = this.#generation;
        this.#items = [];
        this.#flushing = true;
        this.#notify();
        this.#logger.debug(`flushing ${items.length} items...`);
        const promise = this.#invokeFlusher(items, gen);
        this.#inFlight = promise;
        try {
            return await promise;
        } finally{
            this.#inFlight = undefined;
            this.#flushing = false;
            this.#notify();
        }
    }
    async #invokeFlusher(items, gen) {
        try {
            const result = await this._flusher(items);
            this.#logger.debug(`flush complete (result: ${result})`);
            return result;
        } catch (e) {
            this.#logger.debug(`flush threw, requeuing ${items.length} items`);
            if (gen === this.#generation) {
                this.#requeue(items);
            } else {
                this.#logger.debug("skipping requeue (buffer was reset)");
            }
            try {
                this.#config.onFlushError?.(items, e);
            } catch (cbErr) {
                this.#logger.warn("onFlushError callback threw", cbErr);
            }
            throw e;
        }
    }
    #requeue(items) {
        this.#items = items.concat(this.#items);
        this.#applyCap();
    }
    #applyCap() {
        const max = this.#config.maxBatchSize;
        if (this.#items.length > max) {
            const drop = this.#items.length - max;
            const dropped = this.#items.slice(0, drop);
            this.#droppedCount += drop;
            this.#items = this.#items.slice(drop);
            this.#logger.debug(`maxBatchSize cap applied (dropped: ${drop}, total: ${this.#droppedCount})`);
            try {
                this.#config.onDrop?.(dropped);
            } catch (e) {
                this.#logger.warn("onDrop callback threw", e);
            }
        }
    }
    #doFlush;
    #scheduleFlush;
    start() {
        if (this.#running) {
            this.#logger.debug("start: already running");
            return;
        }
        this.#logger.debug("start");
        this.#running = true;
        this.#notify();
        this.#scheduleFlush();
    }
    stop() {
        if (!this.#running) {
            this.#logger.debug("stop: not running");
            return;
        }
        this.#logger.debug("stop");
        this.#running = false;
        if (this.#flushTimer !== undefined) {
            clearTimeout(this.#flushTimer);
            this.#flushTimer = undefined;
        }
        this.#notify();
    }
    async drain() {
        this.#logger.debug("drain");
        const result = await this.flush();
        this.stop();
        return result;
    }
    configure(config) {
        if (!config) return;
        if (config.maxBatchSize !== undefined && (!Number.isFinite(config.maxBatchSize) || config.maxBatchSize <= 0)) {
            throw new RangeError(`BatchFlusher: maxBatchSize must be a finite number > 0, got ${config.maxBatchSize}`);
        }
        if (config.flushIntervalMs !== undefined && (!Number.isFinite(config.flushIntervalMs) || config.flushIntervalMs < 0)) {
            throw new RangeError(`BatchFlusher: flushIntervalMs must be a finite number >= 0, got ${config.flushIntervalMs}`);
        }
        if (config.flushThreshold !== undefined && (!Number.isFinite(config.flushThreshold) || config.flushThreshold < 0)) {
            throw new RangeError(`BatchFlusher: flushThreshold must be a finite number >= 0, got ${config.flushThreshold}`);
        }
        for (const [k, v] of Object.entries(config)){
            if (v !== undefined) {
                this.#config[k] = v;
            }
        }
        if (config.logger !== undefined) {
            this.#logger = withNamespace(config.logger, "BatchFlusher");
        }
    }
    subscribe(callback) {
        callback(this.#getState());
        return this.#pubsub.subscribe("state", callback);
    }
}
function uuid() {
    const c = globalThis.crypto;
    if (c?.randomUUID) {
        return c.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (c?.getRandomValues) {
        c.getRandomValues(bytes);
    } else {
        for(let i = 0; i < 16; i++)bytes[i] = Math.random() * 256 | 0;
    }
    bytes[6] = bytes[6] & 0x0f | 0x40;
    bytes[8] = bytes[8] & 0x3f | 0x80;
    const hex = [];
    for(let i = 0; i < 16; i++)hex.push(bytes[i].toString(16).padStart(2, "0"));
    return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" + hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" + hex.slice(10, 16).join("");
}
function buildEnvelope(name, data, identity) {
    return {
        eventId: uuid(),
        name,
        data,
        timestamp: new Date().toISOString(),
        sessionId: identity.sessionId,
        userId: identity.userId,
        traits: identity.traits ? {
            ...identity.traits
        } : null,
        context: {
            ...identity.context
        }
    };
}
const defaultLogger = createClog("tracker");
class Tracker {
    #options;
    #logger;
    #enrichers;
    #middleware;
    #sessionId;
    #userId = null;
    #traits = null;
    #context;
    #paused = false;
    #batch;
    #pubsub = createPubSub();
    #unsubscribeBatch;
    #lastBatchState;
    constructor(options){
        this.#options = options;
        this.#logger = options.logger ?? defaultLogger;
        this.#enrichers = options.enrichers ? [
            ...options.enrichers
        ] : [];
        this.#middleware = options.middleware ? [
            ...options.middleware
        ] : [];
        this.#sessionId = options.sessionId ?? uuid();
        this.#context = options.context ? {
            ...options.context
        } : {};
        if (options.user) {
            this.#userId = options.user.id;
            this.#traits = options.user.traits ? {
                ...options.user.traits
            } : null;
        }
        this.#batch = new BatchFlusher(async (events)=>{
            if (options.debug) {
                this.#logger.log("flushing batch", events.length);
            }
            const result = await options.transport(events);
            return result === undefined ? true : result;
        }, {
            flushIntervalMs: options.flushIntervalMs ?? 5000,
            flushThreshold: options.flushThreshold ?? 50,
            maxBatchSize: options.maxBatchSize ?? 500,
            onFlushError: (items, err)=>{
                this.#logger.warn("flush failed, requeued", items.length, err);
            },
            onDrop: (items)=>{
                this.#logger.warn("dropped", items.length);
            }
        });
        this.#lastBatchState = {
            size: 0,
            isFlushing: false,
            isRunning: true
        };
        this.#unsubscribeBatch = this.#batch.subscribe((state)=>{
            this.#lastBatchState = state;
            this.#notify();
        });
    }
    track(name, ...args) {
        const data = args[0];
        if (this.#paused) {
            if (this.#options.debug) {
                this.#logger.log("track (paused, dropped)", name, data);
            }
            return;
        }
        let envelope = buildEnvelope(name, data, {
            sessionId: this.#sessionId,
            userId: this.#userId,
            traits: this.#traits,
            context: this.#context
        });
        for (const fn of this.#enrichers){
            envelope = fn(envelope);
        }
        if (this.#options.debug) {
            this.#logger.log("track", envelope);
        }
        for (const fn of this.#middleware){
            const out = fn(envelope);
            if (out === null) return;
            envelope = out;
        }
        this.#batch.add(envelope);
    }
    identify(id, traits) {
        this.#userId = id;
        this.#traits = traits ? {
            ...traits
        } : null;
    }
    reset() {
        this.#userId = null;
        this.#traits = null;
        this.#sessionId = uuid();
    }
    setContext(patch, mode = "merge") {
        if (mode === "replace") {
            this.#context = {
                ...patch
            };
        } else {
            this.#context = {
                ...this.#context,
                ...patch
            };
        }
    }
    flush() {
        return this.#batch.flush();
    }
    async drain() {
        await this.#batch.drain();
    }
    pause() {
        if (this.#paused) return;
        this.#paused = true;
        this.#notify();
    }
    resume() {
        if (!this.#paused) return;
        this.#paused = false;
        this.#notify();
    }
    subscribe(fn) {
        const unsub = this.#pubsub.subscribe("state", fn);
        fn(this.getState());
        return unsub;
    }
    getState() {
        return {
            size: this.#lastBatchState.size,
            isFlushing: this.#lastBatchState.isFlushing,
            isRunning: this.#lastBatchState.isRunning,
            isPaused: this.#paused,
            droppedCount: this.#batch.droppedCount
        };
    }
    get sessionId() {
        return this.#sessionId;
    }
    dump() {
        return this.#batch.dump();
    }
    clear() {
        this.#batch.reset();
    }
    dispose() {
        this.#batch.stop();
        this.#unsubscribeBatch();
        this.#pubsub.unsubscribeAll();
    }
    #notify() {
        this.#pubsub.publish("state", this.getState());
    }
}
const defaultLogger1 = createClog("tracker:unload");
function attachUnloadFlush(tracker, options = {}) {
    const target = options.target ?? globalThis;
    const logger = options.logger ?? defaultLogger1;
    const addListener = target.addEventListener;
    const removeListener = target.removeEventListener;
    if (typeof addListener !== "function" || typeof removeListener !== "function") {
        return ()=>{};
    }
    let hasFiredOnce = false;
    const serialize = options.serialize ?? ((events)=>JSON.stringify({
            events
        }));
    const fire = ()=>{
        if (hasFiredOnce) return;
        hasFiredOnce = true;
        const events = tracker.dump();
        const url = options.beaconUrl;
        if (url && events.length > 0) {
            const nav = globalThis.navigator;
            if (nav?.sendBeacon) {
                let ok = false;
                try {
                    ok = nav.sendBeacon(url, serialize(events));
                } catch (e) {
                    logger.warn("sendBeacon threw", e);
                    ok = false;
                }
                if (ok) {
                    tracker.clear();
                    return;
                }
                logger.warn("sendBeacon returned false (payload too large?), falling back to drain()");
            }
        }
        void tracker.drain();
    };
    const onVisibility = ()=>{
        const doc = globalThis.document;
        if (doc?.visibilityState === "hidden") fire();
    };
    const onPageHide = ()=>fire();
    const onPageShow = ()=>{
        hasFiredOnce = false;
    };
    target.addEventListener("pagehide", onPageHide);
    target.addEventListener("visibilitychange", onVisibility);
    target.addEventListener("pageshow", onPageShow);
    return ()=>{
        target.removeEventListener("pagehide", onPageHide);
        target.removeEventListener("visibilitychange", onVisibility);
        target.removeEventListener("pageshow", onPageShow);
    };
}
const clog = createClog("tracker:example", {
    color: "auto"
});
const scrubEmail = (e)=>{
    const d = e.data;
    if (!d || typeof d.email !== "string") return e;
    return {
        ...e,
        data: {
            ...d,
            email: "[redacted]"
        }
    };
};
const tracker = new Tracker({
    transport: (events)=>{
        clog(`[transport] flushing ${events.length} event(s)`, events);
        return Promise.resolve(true);
    },
    logger: clog,
    flushIntervalMs: 5000,
    flushThreshold: 10,
    debug: true,
    middleware: [
        scrubEmail
    ],
    context: {
        appVersion: "1.0.0",
        build: "demo"
    }
});
tracker.identify("user-123", {
    plan: "pro"
});
attachUnloadFlush(tracker);
document.addEventListener("click", (event)=>{
    const target = event.target;
    const el = target?.closest("[data-track]");
    if (!el) return;
    const name = el.dataset.track;
    let payload;
    const raw = el.dataset.trackPayload;
    if (raw) {
        try {
            payload = JSON.parse(raw);
        } catch  {
            payload = raw;
        }
    }
    tracker.track(name, payload);
});
tracker.subscribe((s)=>{
    const el = document.getElementById("state");
    if (el) el.textContent = JSON.stringify(s, null, 2);
});
globalThis.tracker = tracker;
globalThis.clog = clog;
tracker.track("page.view", {
    path: location.pathname
});
