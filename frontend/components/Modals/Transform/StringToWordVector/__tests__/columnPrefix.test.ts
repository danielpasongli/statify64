import { DEFAULT_COLUMN_PREFIX, MAX_COLUMN_PREFIX_LENGTH, validateColumnPrefix } from "../utils/columnPrefix";
import { buildColumnData } from "../utils/buildColumnData";

describe("validateColumnPrefix", () => {
    it("default VEC_ sah", () => {
        expect(DEFAULT_COLUMN_PREFIX).toBe("VEC_");
        expect(validateColumnPrefix(DEFAULT_COLUMN_PREFIX)).toBeNull();
    });

    it.each(["tfidf_", "W.", "@vec", "#v", "$x_1", "A"])("sah: %s", (p) => {
        expect(validateColumnPrefix(p)).toBeNull();
    });

    it.each([
        ["", "kosong"],
        ["   ", "kosong"],
        ["a b", "spasi"],
        [" VEC_", "spasi"],
        ["1VEC_", "diawali"],
        ["_VEC", "diawali"],
        ["VEC-", "hanya boleh"],
        ["VÉC_", "hanya boleh"],
    ])("tidak sah: %j", (p) => {
        expect(validateColumnPrefix(p)).not.toBeNull();
    });

    it("terlalu panjang", () => {
        expect(validateColumnPrefix("A".repeat(MAX_COLUMN_PREFIX_LENGTH))).toBeNull();
        expect(validateColumnPrefix("A".repeat(MAX_COLUMN_PREFIX_LENGTH + 1))).not.toBeNull();
    });
});

describe("buildColumnData dengan awalan kustom", () => {
    const result = { vocabulary: ["a", "b"], matrix: [[1, 0], [0, 2]] };
    const ident = (base: string) => base;

    it("default memakai VEC_", () => {
        expect(buildColumnData(result, ident).map((c) => c.variable_name)).toEqual(["VEC_a", "VEC_b"]);
    });

    it("memakai awalan yang diberikan", () => {
        expect(buildColumnData(result, ident, "tfidf_").map((c) => c.variable_name)).toEqual(["tfidf_a", "tfidf_b"]);
    });

    it("fallback nama memakai awalan", () => {
        const none = () => undefined;
        expect(buildColumnData(result, none, "X_").map((c) => c.variable_name)).toEqual(["X_VAR_0", "X_VAR_1"]);
    });
});
