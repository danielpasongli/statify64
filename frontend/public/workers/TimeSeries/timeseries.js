let wasm;

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    }
}

let WASM_VECTOR_LEN = 0;

const ARDLFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ardl_free(ptr >>> 0, 1));

const ArchLMResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_archlmresult_free(ptr >>> 0, 1));

const ArimaFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_arima_free(ptr >>> 0, 1));

const AugmentedDickeyFullerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_augmenteddickeyfuller_free(ptr >>> 0, 1));

const AutocorrelationFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_autocorrelation_free(ptr >>> 0, 1));

const BoundsTestResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_boundstestresult_free(ptr >>> 0, 1));

const CointegrationResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_cointegrationresult_free(ptr >>> 0, 1));

const DecompositionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_decomposition_free(ptr >>> 0, 1));

const DickeyFullerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_dickeyfuller_free(ptr >>> 0, 1));

const ECMFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ecm_free(ptr >>> 0, 1));

const GARCHFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_garch_free(ptr >>> 0, 1));

const MultipleLinearRegressionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_multiplelinearregression_free(ptr >>> 0, 1));

const NoInterceptLinearRegressionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_nointerceptlinearregression_free(ptr >>> 0, 1));

const OLSResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_olsresult_free(ptr >>> 0, 1));

const SimpleExponentialRegressionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_simpleexponentialregression_free(ptr >>> 0, 1));

const SimpleLinearRegressionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_simplelinearregression_free(ptr >>> 0, 1));

const SmoothingFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_smoothing_free(ptr >>> 0, 1));

export class ARDL {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ARDLFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ardl_free(ptr, 0);
    }
    estimate_ardl_ecm() {
        const ret = wasm.ardl_estimate_ardl_ecm(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Pesaran ARDL Bounds Test for Cointegration
     * F-statistic untuk test: H0: No long-run relationship
     * @param {number} unrestricted_ssr
     * @param {number} restricted_ssr
     * @param {number} n_obs
     * @returns {BoundsTestResult}
     */
    calculate_bounds_test(unrestricted_ssr, restricted_ssr, n_obs) {
        const ret = wasm.ardl_calculate_bounds_test(this.__wbg_ptr, unrestricted_ssr, restricted_ssr, n_obs);
        return BoundsTestResult.__wrap(ret);
    }
    /**
     * Calculate standard errors for long-run coefficients (Delta method)
     * SE(θ_j) ≈ SE(short_run) / (1 - Σα_i)  (simplified)
     * @param {Float64Array} short_run_se
     * @returns {Float64Array}
     */
    calculate_long_run_se(short_run_se) {
        const ptr0 = passArrayF64ToWasm0(short_run_se, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ardl_calculate_long_run_se(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * Calculate long-run coefficients from ARDL short-run estimates
     * Long-run: θ_j = (Σβ_{j,k}) / (1 - Σα_i)
     * @param {Float64Array} short_run_coef
     * @returns {Float64Array}
     */
    calculate_long_run_coefficients(short_run_coef) {
        const ptr0 = passArrayF64ToWasm0(short_run_coef, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ardl_calculate_long_run_coefficients(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @returns {number}
     */
    get_n_vars() {
        const ret = wasm.ardl_get_n_vars(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_bg_stat() {
        const ret = wasm.ardl_get_bg_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_bp_stat() {
        const ret = wasm.ardl_get_bp_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_jb_stat() {
        const ret = wasm.ardl_get_jb_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_bg_p_value() {
        const ret = wasm.ardl_get_bg_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_bp_p_value() {
        const ret = wasm.ardl_get_bp_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_jb_p_value() {
        const ret = wasm.ardl_get_jb_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_adf_p_value() {
        const ret = wasm.ardl_get_adf_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_p_values() {
        const ret = wasm.ardl_get_lr_p_values(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_sr_p_values() {
        const ret = wasm.ardl_get_sr_p_values(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_lr_r_squared() {
        const ret = wasm.ardl_get_lr_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_residuals() {
        const ret = wasm.ardl_get_lr_residuals(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_sr_r_squared() {
        const ret = wasm.ardl_get_sr_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_sr_residuals() {
        const ret = wasm.ardl_get_sr_residuals(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_adf_statistic() {
        const ret = wasm.ardl_get_adf_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_std_errors() {
        const ret = wasm.ardl_get_lr_std_errors(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_sr_std_errors() {
        const ret = wasm.ardl_get_sr_std_errors(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_lr_f_statistic() {
        const ret = wasm.ardl_get_lr_f_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_sr_f_statistic() {
        const ret = wasm.ardl_get_sr_f_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get_is_cointegrated() {
        const ret = wasm.ardl_get_is_cointegrated(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_coefficients() {
        const ret = wasm.ardl_get_lr_coefficients(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_t_statistics() {
        const ret = wasm.ardl_get_lr_t_statistics(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_sr_coefficients() {
        const ret = wasm.ardl_get_sr_coefficients(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_sr_t_statistics() {
        const ret = wasm.ardl_get_sr_t_statistics(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_lr_adj_r_squared() {
        const ret = wasm.ardl_get_lr_adj_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_sr_adj_r_squared() {
        const ret = wasm.ardl_get_sr_adj_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Float64Array} y
     * @param {Float64Array} x_flat
     * @param {number} n_vars
     * @param {number} p
     * @param {Uint32Array} q_flat
     */
    constructor(y, x_flat, n_vars, p, q_flat) {
        const ptr0 = passArrayF64ToWasm0(y, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(x_flat, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(q_flat, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.ardl_new(ptr0, len0, ptr1, len1, n_vars, p, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0] >>> 0;
        ARDLFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} var_index
     * @param {number} obs_index
     * @returns {number}
     */
    get_x(var_index, obs_index) {
        const ret = wasm.ardl_get_x(this.__wbg_ptr, var_index, obs_index);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_n_obs() {
        const ret = wasm.ardl_get_n_obs(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) ARDL.prototype[Symbol.dispose] = ARDL.prototype.free;

export class ArchLMResult {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ArchLMResult.prototype);
        obj.__wbg_ptr = ptr;
        ArchLMResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ArchLMResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_archlmresult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get lm_statistic() {
        const ret = wasm.__wbg_get_archlmresult_lm_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set lm_statistic(arg0) {
        wasm.__wbg_set_archlmresult_lm_statistic(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get p_value() {
        const ret = wasm.__wbg_get_archlmresult_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set p_value(arg0) {
        wasm.__wbg_set_archlmresult_p_value(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {boolean}
     */
    get has_arch_effect() {
        const ret = wasm.__wbg_get_archlmresult_has_arch_effect(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {boolean} arg0
     */
    set has_arch_effect(arg0) {
        wasm.__wbg_set_archlmresult_has_arch_effect(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get f_statistic() {
        const ret = wasm.__wbg_get_archlmresult_f_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set f_statistic(arg0) {
        wasm.__wbg_set_archlmresult_f_statistic(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get f_p_value() {
        const ret = wasm.__wbg_get_archlmresult_f_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set f_p_value(arg0) {
        wasm.__wbg_set_archlmresult_f_p_value(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) ArchLMResult.prototype[Symbol.dispose] = ArchLMResult.prototype.free;

export class Arima {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ArimaFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_arima_free(ptr, 0);
    }
    /**
     * @returns {Float64Array}
     */
    get_ar_coef() {
        const ret = wasm.arima_get_ar_coef(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_i_order() {
        const ret = wasm.arima_get_i_order(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_ma_coef() {
        const ret = wasm.arima_get_ma_coef(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_res_var() {
        const ret = wasm.arima_get_res_var(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Float64Array} ar_coef
     */
    set_ar_coef(ar_coef) {
        const ptr0 = passArrayF64ToWasm0(ar_coef, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.arima_set_ar_coef(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} ma_coef
     */
    set_ma_coef(ma_coef) {
        const ptr0 = passArrayF64ToWasm0(ma_coef, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.arima_set_ma_coef(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} res_var
     */
    set_res_var(res_var) {
        wasm.arima_set_res_var(this.__wbg_ptr, res_var);
    }
    /**
     * @returns {number}
     */
    get_ar_order() {
        const ret = wasm.arima_get_ar_order(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_constant() {
        const ret = wasm.arima_get_constant(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_ma_order() {
        const ret = wasm.arima_get_ma_order(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} constant
     */
    set_constant(constant) {
        wasm.arima_set_constant(this.__wbg_ptr, constant);
    }
    /**
     * @param {Float64Array} data
     * @param {number} ar_order
     * @param {number} i_order
     * @param {number} ma_order
     */
    constructor(data, ar_order, i_order, ma_order) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.arima_new(ptr0, len0, ar_order, i_order, ma_order);
        this.__wbg_ptr = ret >>> 0;
        ArimaFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float64Array}
     */
    get_data() {
        const ret = wasm.arima_get_data(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} data
     */
    set_data(data) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.arima_set_data(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    forecast() {
        const ret = wasm.arima_forecast(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    estimate_se() {
        const ret = wasm.arima_estimate_se(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    intercept_se() {
        const ret = wasm.arima_intercept_se(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    coeficient_se() {
        const ret = wasm.arima_coeficient_se(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    t_stat() {
        const ret = wasm.arima_t_stat(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    p_value() {
        const ret = wasm.arima_p_value(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    res_variance() {
        const ret = wasm.arima_res_variance(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    res_sum_of_square() {
        const ret = wasm.arima_res_sum_of_square(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} intercept
     * @param {Float64Array} ar
     * @param {Float64Array} ma
     * @param {Float64Array} data
     * @returns {Float64Array}
     */
    est_res(intercept, ar, ma, data) {
        const ptr0 = passArrayF64ToWasm0(ar, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(ma, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.arima_est_res(this.__wbg_ptr, intercept, ptr0, len0, ptr1, len1, ptr2, len2);
        var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v4;
    }
    /**
     * @returns {Float64Array}
     */
    estimate_coef() {
        const ret = wasm.arima_estimate_coef(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    calculate_dw() {
        const ret = wasm.arima_calculate_dw(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_r2() {
        const ret = wasm.arima_calculate_r2(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_aic() {
        const ret = wasm.arima_calculate_aic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_hqc() {
        const ret = wasm.arima_calculate_hqc(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_mse() {
        const ret = wasm.arima_calculate_mse(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sbc() {
        const ret = wasm.arima_calculate_sbc(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sse() {
        const ret = wasm.arima_calculate_sse(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sst() {
        const ret = wasm.arima_calculate_sst(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_f_prob() {
        const ret = wasm.arima_calculate_f_prob(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_f_stat() {
        const ret = wasm.arima_calculate_f_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_r2_adj() {
        const ret = wasm.arima_calculate_r2_adj(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sd_dep() {
        const ret = wasm.arima_calculate_sd_dep(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_se_reg() {
        const ret = wasm.arima_calculate_se_reg(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_mean_dep() {
        const ret = wasm.arima_calculate_mean_dep(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    selection_criteria() {
        const ret = wasm.arima_selection_criteria(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    calculate_log_likelihood() {
        const ret = wasm.arima_calculate_log_likelihood(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {any}
     */
    forecasting_evaluation() {
        const ret = wasm.arima_forecasting_evaluation(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Arima.prototype[Symbol.dispose] = Arima.prototype.free;

export class AugmentedDickeyFuller {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AugmentedDickeyFullerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_augmenteddickeyfuller_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    calculate_pvalue() {
        const ret = wasm.augmenteddickeyfuller_calculate_pvalue(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_test_stat() {
        const ret = wasm.augmenteddickeyfuller_calculate_test_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    calculate_critical_value() {
        const ret = wasm.augmenteddickeyfuller_calculate_critical_value(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_se_vec() {
        const ret = wasm.augmenteddickeyfuller_get_se_vec(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} se_vec
     */
    set_se_vec(se_vec) {
        const ptr0 = passArrayF64ToWasm0(se_vec, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.augmenteddickeyfuller_set_se_vec(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {string}
     */
    get_equation() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.augmenteddickeyfuller_get_equation(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Float64Array}
     */
    get_sel_crit() {
        const ret = wasm.augmenteddickeyfuller_get_sel_crit(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {string} equation
     */
    set_equation(equation) {
        const ptr0 = passStringToWasm0(equation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.augmenteddickeyfuller_set_equation(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} sel_crit
     */
    set_sel_crit(sel_crit) {
        const ptr0 = passArrayF64ToWasm0(sel_crit, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.augmenteddickeyfuller_set_sel_crit(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {number}
     */
    get_test_stat() {
        const ret = wasm.augmenteddickeyfuller_get_test_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} test_stat
     */
    set_test_stat(test_stat) {
        wasm.augmenteddickeyfuller_set_test_stat(this.__wbg_ptr, test_stat);
    }
    /**
     * @returns {Float64Array}
     */
    get_p_value_vec() {
        const ret = wasm.augmenteddickeyfuller_get_p_value_vec(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} p_value_vec
     */
    set_p_value_vec(p_value_vec) {
        const ptr0 = passArrayF64ToWasm0(p_value_vec, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.augmenteddickeyfuller_set_p_value_vec(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_test_stat_vec() {
        const ret = wasm.augmenteddickeyfuller_get_test_stat_vec(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} test_stat_vec
     */
    set_test_stat_vec(test_stat_vec) {
        const ptr0 = passArrayF64ToWasm0(test_stat_vec, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.augmenteddickeyfuller_set_test_stat_vec(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} data
     * @param {string} equation
     * @param {string} level
     * @param {number} lag
     */
    constructor(data, equation, level, lag) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(equation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(level, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.augmenteddickeyfuller_new(ptr0, len0, ptr1, len1, ptr2, len2, lag);
        this.__wbg_ptr = ret >>> 0;
        AugmentedDickeyFullerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get_b() {
        const ret = wasm.augmenteddickeyfuller_get_b(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} b
     */
    set_b(b) {
        wasm.augmenteddickeyfuller_set_b(this.__wbg_ptr, b);
    }
    /**
     * @returns {number}
     */
    get_se() {
        const ret = wasm.augmenteddickeyfuller_get_se(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} se
     */
    set_se(se) {
        wasm.augmenteddickeyfuller_set_se(this.__wbg_ptr, se);
    }
    /**
     * @returns {number}
     */
    get_lag() {
        const ret = wasm.augmenteddickeyfuller_get_lag(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_data() {
        const ret = wasm.augmenteddickeyfuller_get_data(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} data
     */
    set_data(data) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.augmenteddickeyfuller_set_data(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_b_vec() {
        const ret = wasm.augmenteddickeyfuller_get_b_vec(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {string}
     */
    get_level() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.augmenteddickeyfuller_get_level(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {Float64Array} b_vec
     */
    set_b_vec(b_vec) {
        const ptr0 = passArrayF64ToWasm0(b_vec, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.augmenteddickeyfuller_set_b_vec(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string} level
     */
    set_level(level) {
        const ptr0 = passStringToWasm0(level, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.augmenteddickeyfuller_set_level(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) AugmentedDickeyFuller.prototype[Symbol.dispose] = AugmentedDickeyFuller.prototype.free;

export class Autocorrelation {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AutocorrelationFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_autocorrelation_free(ptr, 0);
    }
    /**
     * @returns {Float64Array}
     */
    get_acf_se() {
        const ret = wasm.autocorrelation_get_acf_se(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} acf_se
     */
    set_acf_se(acf_se) {
        const ptr0 = passArrayF64ToWasm0(acf_se, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.autocorrelation_set_acf_se(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_pacf_se() {
        const ret = wasm.autocorrelation_get_pacf_se(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} pacf_se
     */
    set_pacf_se(pacf_se) {
        const ptr0 = passArrayF64ToWasm0(pacf_se, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.autocorrelation_set_pacf_se(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_pvalue_lb() {
        const ret = wasm.autocorrelation_get_pvalue_lb(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} pvalue_lb
     */
    set_pvalue_lb(pvalue_lb) {
        const ptr0 = passArrayF64ToWasm0(pvalue_lb, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.autocorrelation_set_pvalue_lb(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} data
     * @param {number} lag
     */
    constructor(data, lag) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_new(ptr0, len0, lag);
        this.__wbg_ptr = ret >>> 0;
        AutocorrelationFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float64Array}
     */
    get_lb() {
        const ret = wasm.autocorrelation_get_lb(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} lb
     */
    set_lb(lb) {
        const ptr0 = passArrayF64ToWasm0(lb, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.autocorrelation_set_lb(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_acf() {
        const ret = wasm.autocorrelation_get_acf(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_lag() {
        const ret = wasm.autocorrelation_get_lag(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Float64Array} acf
     */
    set_acf(acf) {
        const ptr0 = passArrayF64ToWasm0(acf, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.autocorrelation_set_acf(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} lag
     */
    set_lag(lag) {
        wasm.autocorrelation_set_lag(this.__wbg_ptr, lag);
    }
    /**
     * @returns {Float64Array}
     */
    get_data() {
        const ret = wasm.autocorrelation_get_data(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_pacf() {
        const ret = wasm.autocorrelation_get_pacf(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} data
     */
    set_data(data) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.autocorrelation_set_data(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} pacf
     */
    set_pacf(pacf) {
        const ptr0 = passArrayF64ToWasm0(pacf, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.autocorrelation_set_pacf(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Uint32Array}
     */
    get_df_lb() {
        const ret = wasm.autocorrelation_get_df_lb(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {Uint32Array} df_lb
     */
    set_df_lb(df_lb) {
        const ptr0 = passArray32ToWasm0(df_lb, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.autocorrelation_set_df_lb(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} difference
     * @returns {Float64Array}
     */
    calculate_acf(difference) {
        const ptr0 = passArrayF64ToWasm0(difference, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_calculate_acf(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} autocorelate
     * @returns {Float64Array}
     */
    calculate_acf_se(autocorelate) {
        const ptr0 = passArrayF64ToWasm0(autocorelate, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_calculate_acf_se(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} autocorrelate
     * @returns {Float64Array}
     */
    calculate_pacf(autocorrelate) {
        const ptr0 = passArrayF64ToWasm0(autocorrelate, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_calculate_pacf(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} partial_autocorelate
     * @returns {Float64Array}
     */
    calculate_pacf_se(partial_autocorelate) {
        const ptr0 = passArrayF64ToWasm0(partial_autocorelate, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_calculate_pacf_se(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} se
     * @param {number} alpha
     * @returns {Float64Array}
     */
    calculate_bartlet_left(se, alpha) {
        const ptr0 = passArrayF64ToWasm0(se, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_calculate_bartlet_left(this.__wbg_ptr, ptr0, len0, alpha);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} se
     * @param {number} alpha
     * @returns {Float64Array}
     */
    calculate_bartlet_right(se, alpha) {
        const ptr0 = passArrayF64ToWasm0(se, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_calculate_bartlet_right(this.__wbg_ptr, ptr0, len0, alpha);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} ljung_box
     * @returns {Uint32Array}
     */
    df_ljung_box(ljung_box) {
        const ptr0 = passArrayF64ToWasm0(ljung_box, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_df_ljung_box(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * @param {Float64Array} ljung_box
     * @returns {Float64Array}
     */
    pvalue_ljung_box(ljung_box) {
        const ptr0 = passArrayF64ToWasm0(ljung_box, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_pvalue_ljung_box(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} autocorrelate
     * @returns {Float64Array}
     */
    calculate_ljung_box(autocorrelate) {
        const ptr0 = passArrayF64ToWasm0(autocorrelate, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.autocorrelation_calculate_ljung_box(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {string} difference
     * @param {boolean} use_seasonal
     * @param {number} seasonally
     */
    autocorelate(difference, use_seasonal, seasonally) {
        const ptr0 = passStringToWasm0(difference, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.autocorrelation_autocorelate(this.__wbg_ptr, ptr0, len0, use_seasonal, seasonally);
    }
}
if (Symbol.dispose) Autocorrelation.prototype[Symbol.dispose] = Autocorrelation.prototype.free;

export class BoundsTestResult {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(BoundsTestResult.prototype);
        obj.__wbg_ptr = ptr;
        BoundsTestResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BoundsTestResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_boundstestresult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get f_statistic() {
        const ret = wasm.__wbg_get_archlmresult_lm_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set f_statistic(arg0) {
        wasm.__wbg_set_archlmresult_lm_statistic(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {boolean}
     */
    get has_cointegration() {
        const ret = wasm.__wbg_get_boundstestresult_has_cointegration(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {boolean} arg0
     */
    set has_cointegration(arg0) {
        wasm.__wbg_set_boundstestresult_has_cointegration(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) BoundsTestResult.prototype[Symbol.dispose] = BoundsTestResult.prototype.free;

export class CointegrationResult {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CointegrationResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_cointegrationresult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get adf_statistic() {
        const ret = wasm.__wbg_get_archlmresult_lm_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set adf_statistic(arg0) {
        wasm.__wbg_set_archlmresult_lm_statistic(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {boolean}
     */
    get is_cointegrated() {
        const ret = wasm.__wbg_get_boundstestresult_has_cointegration(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {boolean} arg0
     */
    set is_cointegrated(arg0) {
        wasm.__wbg_set_boundstestresult_has_cointegration(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) CointegrationResult.prototype[Symbol.dispose] = CointegrationResult.prototype.free;

export class Decomposition {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DecompositionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_decomposition_free(ptr, 0);
    }
    /**
     * @param {Float64Array} deseasonalizing
     * @returns {Float64Array}
     */
    linear_trend(deseasonalizing) {
        const ptr0 = passArrayF64ToWasm0(deseasonalizing, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decomposition_linear_trend(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} deseasonalizing
     * @returns {Float64Array}
     */
    exponential_trend(deseasonalizing) {
        const ptr0 = passArrayF64ToWasm0(deseasonalizing, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decomposition_exponential_trend(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {string} trend
     * @param {Float64Array} deseasonalizing
     * @returns {Float64Array}
     */
    calculate_multiplicative_trend_component(trend, deseasonalizing) {
        const ptr0 = passStringToWasm0(trend, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(deseasonalizing, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.decomposition_calculate_multiplicative_trend_component(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v3;
    }
    /**
     * @param {string} trend
     * @returns {Float64Array}
     */
    multiplicative_decomposition(trend) {
        const ptr0 = passStringToWasm0(trend, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decomposition_multiplicative_decomposition(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} centered_ma
     * @returns {Float64Array}
     */
    calculate_additive_trend_component(centered_ma) {
        const ptr0 = passArrayF64ToWasm0(centered_ma, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decomposition_calculate_additive_trend_component(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @param {Float64Array} detrended
     * @returns {Float64Array}
     */
    calculate_additive_seasonal_component(detrended) {
        const ptr0 = passArrayF64ToWasm0(detrended, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decomposition_calculate_additive_seasonal_component(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @returns {Float64Array}
     */
    additive_decomposition() {
        const ret = wasm.decomposition_additive_decomposition(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_period() {
        const ret = wasm.decomposition_get_period(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    get_trend_equation() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.decomposition_get_trend_equation(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} trend_equation
     */
    set_trend_equation(trend_equation) {
        const ptr0 = passStringToWasm0(trend_equation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.decomposition_set_trend_equation(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_trend_component() {
        const ret = wasm.decomposition_get_trend_component(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} trend_component
     */
    set_trend_component(trend_component) {
        const ptr0 = passArrayF64ToWasm0(trend_component, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.decomposition_set_trend_component(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_seasonal_indices() {
        const ret = wasm.decomposition_get_seasonal_indices(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} seasonal_indices
     */
    set_seasonal_indices(seasonal_indices) {
        const ptr0 = passArrayF64ToWasm0(seasonal_indices, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.decomposition_set_seasonal_indices(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_seasonal_component() {
        const ret = wasm.decomposition_get_seasonal_component(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} seasonal_component
     */
    set_seasonal_component(seasonal_component) {
        const ptr0 = passArrayF64ToWasm0(seasonal_component, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.decomposition_set_seasonal_component(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_irregular_component() {
        const ret = wasm.decomposition_get_irregular_component(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} irregular_component
     */
    set_irregular_component(irregular_component) {
        const ptr0 = passArrayF64ToWasm0(irregular_component, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.decomposition_set_irregular_component(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} data
     * @param {number} period
     */
    constructor(data, period) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decomposition_new(ptr0, len0, period);
        this.__wbg_ptr = ret >>> 0;
        DecompositionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float64Array}
     */
    get_data() {
        const ret = wasm.decomposition_get_data(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} centered_ma
     * @returns {Float64Array}
     */
    calculate_multiplicative_seasonal_component(centered_ma) {
        const ptr0 = passArrayF64ToWasm0(centered_ma, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decomposition_calculate_multiplicative_seasonal_component(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * @returns {Float64Array}
     */
    calculate_centered_moving_average() {
        const ret = wasm.decomposition_calculate_centered_moving_average(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} forecast
     * @returns {any}
     */
    decomposition_evaluation(forecast) {
        const ptr0 = passArrayF64ToWasm0(forecast, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decomposition_decomposition_evaluation(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
}
if (Symbol.dispose) Decomposition.prototype[Symbol.dispose] = Decomposition.prototype.free;

export class DickeyFuller {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DickeyFullerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_dickeyfuller_free(ptr, 0);
    }
    /**
     * @returns {Float64Array}
     */
    get_se_vec() {
        const ret = wasm.dickeyfuller_get_se_vec(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} se_vec
     */
    set_se_vec(se_vec) {
        const ptr0 = passArrayF64ToWasm0(se_vec, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dickeyfuller_set_se_vec(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {string}
     */
    get_equation() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.dickeyfuller_get_equation(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Float64Array}
     */
    get_sel_crit() {
        const ret = wasm.dickeyfuller_get_sel_crit(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {string} equation
     */
    set_equation(equation) {
        const ptr0 = passStringToWasm0(equation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dickeyfuller_set_equation(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} sel_crit
     */
    set_sel_crit(sel_crit) {
        const ptr0 = passArrayF64ToWasm0(sel_crit, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dickeyfuller_set_sel_crit(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {number}
     */
    get_test_stat() {
        const ret = wasm.augmenteddickeyfuller_get_test_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} test_stat
     */
    set_test_stat(test_stat) {
        wasm.augmenteddickeyfuller_set_test_stat(this.__wbg_ptr, test_stat);
    }
    /**
     * @returns {Float64Array}
     */
    get_p_value_vec() {
        const ret = wasm.dickeyfuller_get_p_value_vec(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} p_value_vec
     */
    set_p_value_vec(p_value_vec) {
        const ptr0 = passArrayF64ToWasm0(p_value_vec, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dickeyfuller_set_p_value_vec(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_test_stat_vec() {
        const ret = wasm.dickeyfuller_get_test_stat_vec(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} test_stat_vec
     */
    set_test_stat_vec(test_stat_vec) {
        const ptr0 = passArrayF64ToWasm0(test_stat_vec, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dickeyfuller_set_test_stat_vec(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} data
     * @param {string} equation
     * @param {string} level
     */
    constructor(data, equation, level) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(equation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(level, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.dickeyfuller_new(ptr0, len0, ptr1, len1, ptr2, len2);
        this.__wbg_ptr = ret >>> 0;
        DickeyFullerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get_b() {
        const ret = wasm.augmenteddickeyfuller_get_b(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} b
     */
    set_b(b) {
        wasm.augmenteddickeyfuller_set_b(this.__wbg_ptr, b);
    }
    /**
     * @returns {number}
     */
    get_se() {
        const ret = wasm.augmenteddickeyfuller_get_se(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} se
     */
    set_se(se) {
        wasm.augmenteddickeyfuller_set_se(this.__wbg_ptr, se);
    }
    /**
     * @returns {Float64Array}
     */
    get_data() {
        const ret = wasm.dickeyfuller_get_data(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} data
     */
    set_data(data) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dickeyfuller_set_data(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_b_vec() {
        const ret = wasm.dickeyfuller_get_b_vec(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {string}
     */
    get_level() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.dickeyfuller_get_level(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {Float64Array} b_vec
     */
    set_b_vec(b_vec) {
        const ptr0 = passArrayF64ToWasm0(b_vec, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dickeyfuller_set_b_vec(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string} level
     */
    set_level(level) {
        const ptr0 = passStringToWasm0(level, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dickeyfuller_set_level(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {number}
     */
    calculate_pvalue() {
        const ret = wasm.dickeyfuller_calculate_pvalue(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_test_stat() {
        const ret = wasm.dickeyfuller_calculate_test_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    calculate_critical_value() {
        const ret = wasm.dickeyfuller_calculate_critical_value(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) DickeyFuller.prototype[Symbol.dispose] = DickeyFuller.prototype.free;

export class ECM {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ECMFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ecm_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get_bg_stat() {
        const ret = wasm.ecm_get_bg_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_bp_stat() {
        const ret = wasm.ecm_get_bp_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_jb_stat() {
        const ret = wasm.ecm_get_jb_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * Run the full ECM chain:
     * 1. Long-run OLS: Y = c + β₁X₁ + ...
     * 2. Cointegration test (ADF on residuals)
     * 3. Short-run ECM: ΔY = α + γ·ECT(-1) + φ·ΔX + ε
     * 4. Classical Assumptions on ECM residuals
     */
    estimate_ecm() {
        wasm.ecm_estimate_ecm(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    get_r_squared() {
        const ret = wasm.ecm_get_ecm_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_bg_p_value() {
        const ret = wasm.ecm_get_bg_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_bp_p_value() {
        const ret = wasm.ecm_get_bp_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_jb_p_value() {
        const ret = wasm.ecm_get_jb_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_adf_p_value() {
        const ret = wasm.ecm_get_adf_p_value(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_p_values() {
        const ret = wasm.ecm_get_lr_p_values(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_ecm_p_values() {
        const ret = wasm.ecm_get_ecm_p_values(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_lr_r_squared() {
        const ret = wasm.ecm_get_lr_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_residuals() {
        const ret = wasm.ecm_get_lr_residuals(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_adf_statistic() {
        const ret = wasm.ecm_get_adf_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_ecm_r_squared() {
        const ret = wasm.ecm_get_ecm_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_ecm_residuals() {
        const ret = wasm.ecm_get_ecm_residuals(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_std_errors() {
        const ret = wasm.ecm_get_lr_std_errors(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_ecm_std_errors() {
        const ret = wasm.ecm_get_ecm_std_errors(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * For backward compat with old bivariate structs
     * @returns {number}
     */
    get_long_run_beta0() {
        const ret = wasm.ecm_get_long_run_beta0(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_long_run_beta1() {
        const ret = wasm.ecm_get_long_run_beta1(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_lr_f_statistic() {
        const ret = wasm.ecm_get_lr_f_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_ecm_f_statistic() {
        const ret = wasm.ecm_get_ecm_f_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get_is_cointegrated() {
        const ret = wasm.ecm_get_is_cointegrated(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_coefficients() {
        const ret = wasm.ecm_get_lr_coefficients(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_lr_t_statistics() {
        const ret = wasm.ecm_get_lr_t_statistics(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_ecm_coefficients() {
        const ret = wasm.ecm_get_ecm_coefficients(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_ecm_t_statistics() {
        const ret = wasm.ecm_get_ecm_t_statistics(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_lr_adj_r_squared() {
        const ret = wasm.ecm_get_lr_adj_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_ecm_adj_r_squared() {
        const ret = wasm.ecm_get_ecm_adj_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Float64Array} y
     * @param {Float64Array} x_flat
     * @param {number} n_x
     * @param {number} max_lag_adf
     * @param {number} max_lag_ecm
     */
    constructor(y, x_flat, n_x, max_lag_adf, max_lag_ecm) {
        const ptr0 = passArrayF64ToWasm0(y, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(x_flat, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.ecm_new(ptr0, len0, ptr1, len1, n_x, max_lag_adf, max_lag_ecm);
        this.__wbg_ptr = ret >>> 0;
        ECMFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) ECM.prototype[Symbol.dispose] = ECM.prototype.free;

export class GARCH {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GARCHFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_garch_free(ptr, 0);
    }
    /**
     * Calculate log-likelihood: LL = -0.5 Σ(ln(σ²_t) + ε²_t/σ²_t)
     * @param {Float64Array} variance
     * @returns {number}
     */
    calculate_log_likelihood(variance) {
        const ptr0 = passArrayF64ToWasm0(variance, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.garch_calculate_log_likelihood(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * IGARCH(p,q) — Integrated GARCH (Pure EViews formulation: ω=0, Σ α_i + Σ β_j = 1)
     */
    estimate_igarch() {
        wasm.garch_estimate_igarch(this.__wbg_ptr);
    }
    /**
     * Calculate AIC: -2·LL + 2·k
     * @param {number} log_likelihood
     * @returns {number}
     */
    calculate_aic(log_likelihood) {
        const ret = wasm.garch_calculate_aic(this.__wbg_ptr, log_likelihood);
        return ret;
    }
    /**
     * Calculate BIC: -2·LL + k·ln(n)
     * @param {number} log_likelihood
     * @param {number} n
     * @returns {number}
     */
    calculate_bic(log_likelihood, n) {
        const ret = wasm.garch_calculate_bic(this.__wbg_ptr, log_likelihood, n);
        return ret;
    }
    /**
     * Estimasi GARCH(p,q) via L-BFGS dengan analytical gradient.
     */
    estimate() {
        wasm.garch_estimate(this.__wbg_ptr);
    }
    /**
     * EGARCH(p,q) — Exponential GARCH
     *
     * Model: log(σ²_t) = ω + Σ[α_i·|z_{t-i}| + γ_i·z_{t-i}] + Σ β_j·log(σ²_{t-j})
     * dimana z_t = ε_t/σ_t (standardized residual)
     *
     * Keunggulan EGARCH:
     *   - σ² selalu positif tanpa constraint eksplisit (karena exp())
     *   - γ_i menangkap leverage effect (bad news impact lebih besar)
     *
     * Estimasi: L-BFGS dengan analytical gradient pada log-variance recursion.
     */
    estimate_egarch() {
        wasm.garch_estimate_egarch(this.__wbg_ptr);
    }
    /**
     * Hitung conditional variance untuk EGARCH secara manual (untuk inspeksi).
     * Memerlukan parameter lengkap dari luar (biasanya setelah estimate_egarch).
     * @param {number} omega
     * @param {Float64Array} alpha
     * @param {Float64Array} gamma
     * @param {Float64Array} beta
     * @returns {Float64Array}
     */
    calculate_egarch_variance(omega, alpha, gamma, beta) {
        const ptr0 = passArrayF64ToWasm0(alpha, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(gamma, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(beta, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.garch_calculate_egarch_variance(this.__wbg_ptr, omega, ptr0, len0, ptr1, len1, ptr2, len2);
        var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v4;
    }
    /**
     * TGARCH(p,q) / GJR-GARCH — Threshold GARCH
     *
     * Model: σ²_t = ω + Σ(α_i + γ_i·I_{t-i})·ε²_{t-i} + Σ β_j·σ²_{t-j}
     * dimana I_{t-i} = 1 jika ε_{t-i} < 0 (leverage effect indicator)
     *
     * Interpretasi γ_i:
     *   - γ_i > 0: bad news (ε < 0) meningkatkan volatilitas lebih besar
     *   - γ_i = 0: simetrik (sama dengan GARCH standar)
     *
     * Estimasi: L-BFGS dengan analytical gradient.
     */
    estimate_tgarch() {
        wasm.garch_estimate_tgarch(this.__wbg_ptr);
    }
    /**
     * Hitung conditional variance untuk TGARCH secara manual (untuk inspeksi).
     * @param {number} omega
     * @param {Float64Array} alpha
     * @param {Float64Array} gamma
     * @param {Float64Array} beta
     * @returns {Float64Array}
     */
    calculate_tgarch_variance(omega, alpha, gamma, beta) {
        const ptr0 = passArrayF64ToWasm0(alpha, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(gamma, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(beta, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.garch_calculate_tgarch_variance(this.__wbg_ptr, omega, ptr0, len0, ptr1, len1, ptr2, len2);
        var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v4;
    }
    /**
     * ARCH-LM Test (Engle 1982)
     * H0: No ARCH effects (α_1 = α_2 = ... = α_q = 0)
     * Auxiliary regression: e²_t = β_0 + β_1·e²_{t-1} + ... + β_q·e²_{t-q}
     * Test statistics:
     *   Obs*R² (LM stat) ~ Chi²(q)   [matches EViews "Obs*R-squared"]
     *   F-stat ~ F(q, n-q-1)          [matches EViews "F-statistic"]
     * @param {Float64Array} residuals
     * @param {number} lags
     * @returns {ArchLMResult}
     */
    static arch_lm_test(residuals, lags) {
        const ptr0 = passArrayF64ToWasm0(residuals, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.garch_arch_lm_test(ptr0, len0, lags);
        return ArchLMResult.__wrap(ret);
    }
    /**
     * Calculate conditional variance: σ²_t = ω + Σα_i·ε²_{t-i} + Σβ_j·σ²_{t-j}
     * @param {number} omega
     * @param {Float64Array} alpha
     * @param {Float64Array} beta
     * @returns {Float64Array}
     */
    calculate_variance(omega, alpha, beta) {
        const ptr0 = passArrayF64ToWasm0(alpha, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(beta, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.garch_calculate_variance(this.__wbg_ptr, omega, ptr0, len0, ptr1, len1);
        var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v3;
    }
    /**
     * @returns {Float64Array}
     */
    get_beta_p() {
        const ret = wasm.garch_get_beta_p(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_beta_z() {
        const ret = wasm.garch_get_beta_z(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} p
     */
    set_beta_p(p) {
        const ptr0 = passArrayF64ToWasm0(p, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_beta_p(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} z
     */
    set_beta_z(z) {
        const ptr0 = passArrayF64ToWasm0(z, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_beta_z(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_alpha_p() {
        const ret = wasm.garch_get_alpha_p(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_alpha_z() {
        const ret = wasm.garch_get_alpha_z(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_beta_se() {
        const ret = wasm.garch_get_beta_se(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_gamma_p() {
        const ret = wasm.garch_get_gamma_p(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_gamma_z() {
        const ret = wasm.garch_get_gamma_z(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_omega_p() {
        const ret = wasm.garch_get_omega_p(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_omega_z() {
        const ret = wasm.garch_get_omega_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Float64Array} p
     */
    set_alpha_p(p) {
        const ptr0 = passArrayF64ToWasm0(p, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_alpha_p(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} z
     */
    set_alpha_z(z) {
        const ptr0 = passArrayF64ToWasm0(z, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_alpha_z(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} se
     */
    set_beta_se(se) {
        const ptr0 = passArrayF64ToWasm0(se, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_beta_se(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} p
     */
    set_gamma_p(p) {
        const ptr0 = passArrayF64ToWasm0(p, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_gamma_p(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} z
     */
    set_gamma_z(z) {
        const ptr0 = passArrayF64ToWasm0(z, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_gamma_z(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} p
     */
    set_omega_p(p) {
        wasm.garch_set_omega_p(this.__wbg_ptr, p);
    }
    /**
     * @param {number} z
     */
    set_omega_z(z) {
        wasm.garch_set_omega_z(this.__wbg_ptr, z);
    }
    /**
     * @returns {Float64Array}
     */
    get_alpha_se() {
        const ret = wasm.garch_get_alpha_se(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_gamma_se() {
        const ret = wasm.garch_get_gamma_se(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_omega_se() {
        const ret = wasm.garch_get_omega_se(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_variance() {
        const ret = wasm.garch_get_variance(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} se
     */
    set_alpha_se(se) {
        const ptr0 = passArrayF64ToWasm0(se, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_alpha_se(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} se
     */
    set_gamma_se(se) {
        const ptr0 = passArrayF64ToWasm0(se, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_gamma_se(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} se
     */
    set_omega_se(se) {
        wasm.garch_set_omega_se(this.__wbg_ptr, se);
    }
    /**
     * @param {Float64Array} variance
     */
    set_variance(variance) {
        const ptr0 = passArrayF64ToWasm0(variance, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_variance(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {Float64Array}
     */
    get_residuals() {
        const ret = wasm.garch_get_residuals(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_log_likelihood() {
        const ret = wasm.garch_get_log_likelihood(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} ll
     */
    set_log_likelihood(ll) {
        wasm.garch_set_log_likelihood(this.__wbg_ptr, ll);
    }
    /**
     * @param {Float64Array} data
     * @param {number} p
     * @param {number} q
     */
    constructor(data, p, q) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.garch_new(ptr0, len0, p, q);
        this.__wbg_ptr = ret >>> 0;
        GARCHFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get_p() {
        const ret = wasm.garch_get_p(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_q() {
        const ret = wasm.garch_get_q(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_mu() {
        const ret = wasm.garch_get_mu(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} mu
     */
    set_mu(mu) {
        wasm.garch_set_mu(this.__wbg_ptr, mu);
    }
    /**
     * @returns {number}
     */
    get_aic() {
        const ret = wasm.garch_get_aic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_bic() {
        const ret = wasm.garch_get_bic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} aic
     */
    set_aic(aic) {
        wasm.garch_set_aic(this.__wbg_ptr, aic);
    }
    /**
     * @param {number} bic
     */
    set_bic(bic) {
        wasm.garch_set_bic(this.__wbg_ptr, bic);
    }
    /**
     * @returns {Float64Array}
     */
    get_beta() {
        const ret = wasm.garch_get_beta(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_data() {
        const ret = wasm.garch_get_data(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_mu_p() {
        const ret = wasm.garch_get_mu_p(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_mu_z() {
        const ret = wasm.garch_get_mu_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Float64Array} beta
     */
    set_beta(beta) {
        const ptr0 = passArrayF64ToWasm0(beta, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_beta(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} p
     */
    set_mu_p(p) {
        wasm.garch_set_mu_p(this.__wbg_ptr, p);
    }
    /**
     * @param {number} z
     */
    set_mu_z(z) {
        wasm.garch_set_mu_z(this.__wbg_ptr, z);
    }
    /**
     * @returns {Float64Array}
     */
    get_alpha() {
        const ret = wasm.garch_get_alpha(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_gamma() {
        const ret = wasm.garch_get_gamma(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_mu_se() {
        const ret = wasm.garch_get_mu_se(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_omega() {
        const ret = wasm.garch_get_omega(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Float64Array} alpha
     */
    set_alpha(alpha) {
        const ptr0 = passArrayF64ToWasm0(alpha, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_alpha(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} gamma
     */
    set_gamma(gamma) {
        const ptr0 = passArrayF64ToWasm0(gamma, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.garch_set_gamma(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} se
     */
    set_mu_se(se) {
        wasm.garch_set_mu_se(this.__wbg_ptr, se);
    }
    /**
     * @param {number} omega
     */
    set_omega(omega) {
        wasm.garch_set_omega(this.__wbg_ptr, omega);
    }
}
if (Symbol.dispose) GARCH.prototype[Symbol.dispose] = GARCH.prototype.free;

export class MultipleLinearRegression {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MultipleLinearRegressionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_multiplelinearregression_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    calculate_dw() {
        const ret = wasm.multiplelinearregression_calculate_dw(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_r2() {
        const ret = wasm.multiplelinearregression_calculate_r2(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_aic() {
        const ret = wasm.multiplelinearregression_calculate_aic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_hqc() {
        const ret = wasm.multiplelinearregression_calculate_hqc(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_mse() {
        const ret = wasm.multiplelinearregression_calculate_mse(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sbc() {
        const ret = wasm.multiplelinearregression_calculate_sbc(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sse() {
        const ret = wasm.multiplelinearregression_calculate_sse(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sst() {
        const ret = wasm.multiplelinearregression_calculate_sst(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_f_prob() {
        const ret = wasm.multiplelinearregression_calculate_f_prob(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_f_stat() {
        const ret = wasm.multiplelinearregression_calculate_f_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_r2_adj() {
        const ret = wasm.multiplelinearregression_calculate_r2_adj(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sd_dep() {
        const ret = wasm.multiplelinearregression_calculate_sd_dep(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_se_reg() {
        const ret = wasm.multiplelinearregression_calculate_se_reg(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_mean_dep() {
        const ret = wasm.multiplelinearregression_calculate_mean_dep(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_log_likelihood() {
        const ret = wasm.multiplelinearregression_calculate_log_likelihood(this.__wbg_ptr);
        return ret;
    }
    calculate_regression() {
        wasm.multiplelinearregression_calculate_regression(this.__wbg_ptr);
    }
    /**
     * @returns {Float64Array}
     */
    calculate_pvalue() {
        const ret = wasm.multiplelinearregression_calculate_pvalue(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    calculate_t_stat() {
        const ret = wasm.multiplelinearregression_calculate_t_stat(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    calculate_standard_error() {
        const ret = wasm.multiplelinearregression_calculate_standard_error(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {boolean}
     */
    get_constant() {
        const ret = wasm.multiplelinearregression_get_constant(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {boolean} constant
     */
    set_constant(constant) {
        wasm.multiplelinearregression_set_constant(this.__wbg_ptr, constant);
    }
    /**
     * @returns {Float64Array}
     */
    get_y_prediction() {
        const ret = wasm.multiplelinearregression_get_y_prediction(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} y_prediction
     */
    set_y_prediction(y_prediction) {
        const ptr0 = passArrayF64ToWasm0(y_prediction, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.multiplelinearregression_set_y_prediction(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {any} x
     * @param {Float64Array} y
     */
    constructor(x, y) {
        const ptr0 = passArrayF64ToWasm0(y, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.multiplelinearregression_new(x, ptr0, len0);
        this.__wbg_ptr = ret >>> 0;
        MultipleLinearRegressionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {any}
     */
    get get_x() {
        const ret = wasm.multiplelinearregression_get_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_y() {
        const ret = wasm.multiplelinearregression_get_y(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_beta() {
        const ret = wasm.multiplelinearregression_get_beta(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} beta
     */
    set_beta(beta) {
        const ptr0 = passArrayF64ToWasm0(beta, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.multiplelinearregression_set_beta(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) MultipleLinearRegression.prototype[Symbol.dispose] = MultipleLinearRegression.prototype.free;

export class NoInterceptLinearRegression {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NoInterceptLinearRegressionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_nointerceptlinearregression_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    calculate_dw() {
        const ret = wasm.nointerceptlinearregression_calculate_dw(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_r2() {
        const ret = wasm.nointerceptlinearregression_calculate_r2(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_aic() {
        const ret = wasm.nointerceptlinearregression_calculate_aic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_hqc() {
        const ret = wasm.nointerceptlinearregression_calculate_hqc(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_mse() {
        const ret = wasm.nointerceptlinearregression_calculate_mse(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sbc() {
        const ret = wasm.nointerceptlinearregression_calculate_sbc(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sse() {
        const ret = wasm.nointerceptlinearregression_calculate_sse(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sst() {
        const ret = wasm.nointerceptlinearregression_calculate_sst(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_f_prob() {
        const ret = wasm.nointerceptlinearregression_calculate_f_prob(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_f_stat() {
        const ret = wasm.nointerceptlinearregression_calculate_f_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_r2_adj() {
        const ret = wasm.nointerceptlinearregression_calculate_r2_adj(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sd_dep() {
        const ret = wasm.nointerceptlinearregression_calculate_sd_dep(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_se_reg() {
        const ret = wasm.nointerceptlinearregression_calculate_se_reg(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_mean_dep() {
        const ret = wasm.nointerceptlinearregression_calculate_mean_dep(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_log_likelihood() {
        const ret = wasm.nointerceptlinearregression_calculate_log_likelihood(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_pvalue() {
        const ret = wasm.nointerceptlinearregression_calculate_pvalue(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_t_stat() {
        const ret = wasm.nointerceptlinearregression_calculate_t_stat(this.__wbg_ptr);
        return ret;
    }
    calculate_regression() {
        wasm.nointerceptlinearregression_calculate_regression(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    calculate_standard_error() {
        const ret = wasm.nointerceptlinearregression_calculate_standard_error(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get_y_prediction() {
        const ret = wasm.nointerceptlinearregression_get_y_prediction(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} y_prediction
     */
    set_y_prediction(y_prediction) {
        const ptr0 = passArrayF64ToWasm0(y_prediction, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.nointerceptlinearregression_set_y_prediction(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} x
     * @param {Float64Array} y
     */
    constructor(x, y) {
        const ptr0 = passArrayF64ToWasm0(x, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(y, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.nointerceptlinearregression_new(ptr0, len0, ptr1, len1);
        this.__wbg_ptr = ret >>> 0;
        NoInterceptLinearRegressionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get_b() {
        const ret = wasm.nointerceptlinearregression_get_b(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float64Array}
     */
    get get_x() {
        const ret = wasm.nointerceptlinearregression_get_x(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_y() {
        const ret = wasm.nointerceptlinearregression_get_y(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} b
     */
    set_b(b) {
        wasm.nointerceptlinearregression_set_b(this.__wbg_ptr, b);
    }
}
if (Symbol.dispose) NoInterceptLinearRegression.prototype[Symbol.dispose] = NoInterceptLinearRegression.prototype.free;

/**
 * Full OLS result: coefficients, SE, t-stat, p-value for each param
 */
export class OLSResult {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        OLSResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_olsresult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get n_obs() {
        const ret = wasm.__wbg_get_olsresult_n_obs(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} arg0
     */
    set n_obs(arg0) {
        wasm.__wbg_set_olsresult_n_obs(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get n_params() {
        const ret = wasm.__wbg_get_olsresult_n_params(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} arg0
     */
    set n_params(arg0) {
        wasm.__wbg_set_olsresult_n_params(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get r_squared() {
        const ret = wasm.__wbg_get_olsresult_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set r_squared(arg0) {
        wasm.__wbg_set_olsresult_r_squared(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get adj_r_squared() {
        const ret = wasm.__wbg_get_olsresult_adj_r_squared(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set adj_r_squared(arg0) {
        wasm.__wbg_set_olsresult_adj_r_squared(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get f_statistic() {
        const ret = wasm.__wbg_get_olsresult_f_statistic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set f_statistic(arg0) {
        wasm.__wbg_set_olsresult_f_statistic(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get sse() {
        const ret = wasm.__wbg_get_olsresult_sse(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set sse(arg0) {
        wasm.__wbg_set_olsresult_sse(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {Float64Array}
     */
    get_fitted() {
        const ret = wasm.olsresult_get_fitted(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_p_values() {
        const ret = wasm.olsresult_get_p_values(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_residuals() {
        const ret = wasm.olsresult_get_residuals(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_std_errors() {
        const ret = wasm.olsresult_get_std_errors(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_coefficients() {
        const ret = wasm.olsresult_get_coefficients(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_t_statistics() {
        const ret = wasm.olsresult_get_t_statistics(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_beta0() {
        const ret = wasm.olsresult_get_beta0(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_beta1() {
        const ret = wasm.olsresult_get_beta1(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) OLSResult.prototype[Symbol.dispose] = OLSResult.prototype.free;

export class SimpleExponentialRegression {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SimpleExponentialRegressionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_simpleexponentialregression_free(ptr, 0);
    }
    calculate_regression() {
        wasm.simpleexponentialregression_calculate_regression(this.__wbg_ptr);
    }
    /**
     * @returns {Float64Array}
     */
    get_y_prediction() {
        const ret = wasm.simpleexponentialregression_get_y_prediction(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} y_prediction
     */
    set_y_prediction(y_prediction) {
        const ptr0 = passArrayF64ToWasm0(y_prediction, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.simpleexponentialregression_set_y_prediction(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} x
     * @param {Float64Array} y
     */
    constructor(x, y) {
        const ptr0 = passArrayF64ToWasm0(x, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(y, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.simpleexponentialregression_new(ptr0, len0, ptr1, len1);
        this.__wbg_ptr = ret >>> 0;
        SimpleExponentialRegressionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float64Array}
     */
    get_x() {
        const ret = wasm.simpleexponentialregression_get_x(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_y() {
        const ret = wasm.simpleexponentialregression_get_y(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_b0() {
        const ret = wasm.augmenteddickeyfuller_get_b(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_b1() {
        const ret = wasm.augmenteddickeyfuller_get_se(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} b0
     */
    set_b0(b0) {
        wasm.augmenteddickeyfuller_set_b(this.__wbg_ptr, b0);
    }
    /**
     * @param {number} b1
     */
    set_b1(b1) {
        wasm.augmenteddickeyfuller_set_se(this.__wbg_ptr, b1);
    }
}
if (Symbol.dispose) SimpleExponentialRegression.prototype[Symbol.dispose] = SimpleExponentialRegression.prototype.free;

export class SimpleLinearRegression {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SimpleLinearRegressionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_simplelinearregression_free(ptr, 0);
    }
    /**
     * @returns {Float64Array}
     */
    calculate_pvalue() {
        const ret = wasm.simplelinearregression_calculate_pvalue(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    calculate_t_stat() {
        const ret = wasm.simplelinearregression_calculate_t_stat(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    calculate_regression() {
        wasm.simplelinearregression_calculate_regression(this.__wbg_ptr);
    }
    /**
     * @returns {Float64Array}
     */
    calculate_standard_error() {
        const ret = wasm.simplelinearregression_calculate_standard_error(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_y_prediction() {
        const ret = wasm.simplelinearregression_get_y_prediction(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} y_prediction
     */
    set_y_prediction(y_prediction) {
        const ptr0 = passArrayF64ToWasm0(y_prediction, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.simplelinearregression_set_y_prediction(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Float64Array} x
     * @param {Float64Array} y
     */
    constructor(x, y) {
        const ptr0 = passArrayF64ToWasm0(x, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF64ToWasm0(y, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.simplelinearregression_new(ptr0, len0, ptr1, len1);
        this.__wbg_ptr = ret >>> 0;
        SimpleLinearRegressionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float64Array}
     */
    get_x() {
        const ret = wasm.simplelinearregression_get_x(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get_y() {
        const ret = wasm.simplelinearregression_get_y(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get_b0() {
        const ret = wasm.simplelinearregression_get_b0(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_b1() {
        const ret = wasm.simplelinearregression_get_b1(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} b0
     */
    set_b0(b0) {
        wasm.simplelinearregression_set_b0(this.__wbg_ptr, b0);
    }
    /**
     * @param {number} b1
     */
    set_b1(b1) {
        wasm.simplelinearregression_set_b1(this.__wbg_ptr, b1);
    }
    /**
     * @returns {number}
     */
    calculate_dw() {
        const ret = wasm.simplelinearregression_calculate_dw(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_r2() {
        const ret = wasm.simplelinearregression_calculate_r2(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_aic() {
        const ret = wasm.simplelinearregression_calculate_aic(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_hqc() {
        const ret = wasm.simplelinearregression_calculate_hqc(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_mse() {
        const ret = wasm.simplelinearregression_calculate_mse(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sbc() {
        const ret = wasm.simplelinearregression_calculate_sbc(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sse() {
        const ret = wasm.simplelinearregression_calculate_sse(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sst() {
        const ret = wasm.simplelinearregression_calculate_sst(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_f_prob() {
        const ret = wasm.simplelinearregression_calculate_f_prob(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_f_stat() {
        const ret = wasm.simplelinearregression_calculate_f_stat(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_r2_adj() {
        const ret = wasm.simplelinearregression_calculate_r2_adj(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_sd_dep() {
        const ret = wasm.simplelinearregression_calculate_sd_dep(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_se_reg() {
        const ret = wasm.simplelinearregression_calculate_se_reg(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_mean_dep() {
        const ret = wasm.simplelinearregression_calculate_mean_dep(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    calculate_log_likelihood() {
        const ret = wasm.simplelinearregression_calculate_log_likelihood(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) SimpleLinearRegression.prototype[Symbol.dispose] = SimpleLinearRegression.prototype.free;

export class Smoothing {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SmoothingFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_smoothing_free(ptr, 0);
    }
    /**
     * @param {Float64Array} forecast
     * @returns {any}
     */
    smoothing_evaluation(forecast) {
        const ptr0 = passArrayF64ToWasm0(forecast, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.smoothing_smoothing_evaluation(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * @param {Float64Array} data
     */
    constructor(data) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.smoothing_new(ptr0, len0);
        this.__wbg_ptr = ret >>> 0;
        SmoothingFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Float64Array}
     */
    get_data() {
        const ret = wasm.smoothing_get_data(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {Float64Array} data
     */
    set_data(data) {
        const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.smoothing_set_data(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} distance
     * @returns {Float64Array}
     */
    calculate_dma(distance) {
        const ret = wasm.smoothing_calculate_dma(this.__wbg_ptr, distance);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} distance
     * @returns {Float64Array}
     */
    calculate_sma(distance) {
        const ret = wasm.smoothing_calculate_sma(this.__wbg_ptr, distance);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} alpha
     * @returns {Float64Array}
     */
    calculate_des(alpha) {
        const ret = wasm.smoothing_calculate_des(this.__wbg_ptr, alpha);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} alpha
     * @returns {Float64Array}
     */
    calculate_ses(alpha) {
        const ret = wasm.smoothing_calculate_ses(this.__wbg_ptr, alpha);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} alpha
     * @param {number} beta
     * @returns {Float64Array}
     */
    calculate_holt(alpha, beta) {
        const ret = wasm.smoothing_calculate_holt(this.__wbg_ptr, alpha, beta);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @param {number} alpha
     * @param {number} beta
     * @param {number} gamma
     * @param {number} period
     * @returns {Float64Array}
     */
    calculate_winter(alpha, beta, gamma, period) {
        const ret = wasm.smoothing_calculate_winter(this.__wbg_ptr, alpha, beta, gamma, period);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) Smoothing.prototype[Symbol.dispose] = Smoothing.prototype.free;

/**
 * @returns {Float64Array}
 */
export function get_gamma_0_tab1() {
    const ret = wasm.get_gamma_0_tab1();
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * @returns {string[]}
 */
export function get_t() {
    const ret = wasm.get_t();
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * @param {number} q
 * @param {Float64Array} data
 * @returns {Float64Array}
 */
export function innov_alg(q, data) {
    const ptr0 = passArrayF64ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.innov_alg(q, ptr0, len0);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * @param {number} k
 * @param {number} j
 * @param {Float64Array} partial_autocorrelate
 * @returns {number}
 */
export function partial_kj(k, j, partial_autocorrelate) {
    const ptr0 = passArrayF64ToWasm0(partial_autocorrelate, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.partial_kj(k, j, ptr0, len0);
    return ret;
}

const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_Error_52673b7de5a0ca89 = function(arg0, arg1) {
        const ret = Error(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg___wbindgen_boolean_get_dea25b33882b895b = function(arg0) {
        const v = arg0;
        const ret = typeof(v) === 'boolean' ? v : undefined;
        return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
    };
    imports.wbg.__wbg___wbindgen_debug_string_adfb662ae34724b6 = function(arg0, arg1) {
        const ret = debugString(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_is_function_8d400b8b1af978cd = function(arg0) {
        const ret = typeof(arg0) === 'function';
        return ret;
    };
    imports.wbg.__wbg___wbindgen_is_object_ce774f3490692386 = function(arg0) {
        const val = arg0;
        const ret = typeof(val) === 'object' && val !== null;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_jsval_loose_eq_766057600fdd1b0d = function(arg0, arg1) {
        const ret = arg0 == arg1;
        return ret;
    };
    imports.wbg.__wbg___wbindgen_number_get_9619185a74197f95 = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'number' ? obj : undefined;
        getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    };
    imports.wbg.__wbg___wbindgen_string_get_a2a31e16edf96e42 = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg___wbindgen_throw_dd24417ed36fc46e = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };
    imports.wbg.__wbg_call_abb4ff46ce38be40 = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.call(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_done_62ea16af4ce34b24 = function(arg0) {
        const ret = arg0.done;
        return ret;
    };
    imports.wbg.__wbg_get_6b7bd52aca3f9671 = function(arg0, arg1) {
        const ret = arg0[arg1 >>> 0];
        return ret;
    };
    imports.wbg.__wbg_get_af9dab7e9603ea93 = function() { return handleError(function (arg0, arg1) {
        const ret = Reflect.get(arg0, arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_instanceof_ArrayBuffer_f3320d2419cd0355 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof ArrayBuffer;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_instanceof_Uint8Array_da54ccc9d3e09434 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Uint8Array;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_isArray_51fd9e6422c0a395 = function(arg0) {
        const ret = Array.isArray(arg0);
        return ret;
    };
    imports.wbg.__wbg_iterator_27b7c8b35ab3e86b = function() {
        const ret = Symbol.iterator;
        return ret;
    };
    imports.wbg.__wbg_length_22ac23eaec9d8053 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_length_d45040a40c570362 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_new_1ba21ce319a06297 = function() {
        const ret = new Object();
        return ret;
    };
    imports.wbg.__wbg_new_25f239778d6112b9 = function() {
        const ret = new Array();
        return ret;
    };
    imports.wbg.__wbg_new_6421f6084cc5bc5a = function(arg0) {
        const ret = new Uint8Array(arg0);
        return ret;
    };
    imports.wbg.__wbg_next_138a17bbf04e926c = function(arg0) {
        const ret = arg0.next;
        return ret;
    };
    imports.wbg.__wbg_next_3cfe5c0fe2a4cc53 = function() { return handleError(function (arg0) {
        const ret = arg0.next();
        return ret;
    }, arguments) };
    imports.wbg.__wbg_prototypesetcall_dfe9b766cdc1f1fd = function(arg0, arg1, arg2) {
        Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
    };
    imports.wbg.__wbg_set_781438a03c0c3c81 = function() { return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(arg0, arg1, arg2);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_set_7df433eea03a5c14 = function(arg0, arg1, arg2) {
        arg0[arg1 >>> 0] = arg2;
    };
    imports.wbg.__wbg_sqrt_8571e640d465225b = function(arg0) {
        const ret = Math.sqrt(arg0);
        return ret;
    };
    imports.wbg.__wbg_value_57b7b035e117f7ee = function(arg0) {
        const ret = arg0.value;
        return ret;
    };
    imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
        // Cast intrinsic for `Ref(String) -> Externref`.
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
    };
    imports.wbg.__wbindgen_cast_d6cd19b81560fd6e = function(arg0) {
        // Cast intrinsic for `F64 -> Externref`.
        const ret = arg0;
        return ret;
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
    };

    return imports;
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('timeseries_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
