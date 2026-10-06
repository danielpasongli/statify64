/**
 * Web Worker: String to Word Vector
 * 
 * Menerima pesan dari UI dengan format:
 * { data: string[], config: VectorizerConfigPayload }
 * 
 * Mengirim balik ke UI:
 * - Sukses : { status: 'success', payload: VectorizerOutput }
 * - Error  : { status: 'error',   payload: { code: string, message: string } }
 */

import init, { process_text_data } from './wasm-output/statify_string_to_word.js';
import type { VectorizerConfigPayload } from './types';
import { normalizeWorkerError } from './utils/normalizeWorkerError';

// Flag agar init() hanya dipanggil sekali selama lifetime Worker
let wasmReady = false;

const initWasm = async (): Promise<void> => {
    if (!wasmReady) {
        await init();
        wasmReady = true;
    }
};

self.onmessage = async (event: MessageEvent) => {
    const { data, config } = event.data as {
        data: string[];
        config: VectorizerConfigPayload;
    };

    try {
        await initWasm();

        // Kirim ke Rust. Jika error, Rust melempar JsValue berisi { code, message }
        const result = process_text_data(data, config);

        self.postMessage({ status: 'success', payload: result });
    } catch (error: unknown) {
        // Error bisa berupa string JSON, objek {code,message}, atau Error init WASM.
        // Selalu dinormalkan agar UI menerima { code, message } yang terisi (F04).
        self.postMessage({ status: 'error', payload: normalizeWorkerError(error) });
    }
};
