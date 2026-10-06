import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { toast } from "sonner";
import {
    TextFeatureTableOutput,
    buildTextFeatureCsv,
    buildTextFeatureCsvFile,
    buildTextFeatureTsv,
    escapeCsvField,
    utf8ByteLength,
    DEFAULT_TEXT_FEATURE_CSV_FILE_NAME,
    TEXT_FEATURE_COPY_LIMIT_BYTES,
    TEXT_FEATURE_COPY_TOO_LARGE_MESSAGE,
} from "@/components/Modals/Analyze/Classify/naive-bayes/components/text-feature-table-output";
import type {
    NaiveBayesTextFeatureFullEntry,
    NaiveBayesTextFeatureTableRaw,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-formatter";

jest.mock("sonner", () => ({
    toast: { warning: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

const entry = (over: Partial<NaiveBayesTextFeatureFullEntry>): NaiveBayesTextFeatureFullEntry => ({
    term: "makan",
    class: "pos",
    count: 4,
    log_weight: -0.875469,
    probability: 0.416667,
    score: 1.321756,
    ...over,
});

const tableOf = (full: NaiveBayesTextFeatureFullEntry[]): NaiveBayesTextFeatureTableRaw => ({
    likelihood: "multinomial",
    classes: ["neg", "pos"],
    k: 2,
    top: {
        neg: [{ term: "tidak", score: 0.98083, log_weight: -1.504077, count: 1 }],
        pos: [{ term: "makan", score: 1.321756, log_weight: -0.875469, count: 4 }],
    },
    full,
});

describe("escapeCsvField", () => {
    it("teks biasa tidak diubah", () => {
        expect(escapeCsvField("makan")).toBe("makan");
    });
    it("koma, kutip, dan baris baru dibungkus kutip; kutip digandakan", () => {
        expect(escapeCsvField("a,b")).toBe('"a,b"');
        expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
        expect(escapeCsvField("baris\nbaru")).toBe('"baris\nbaru"');
        expect(escapeCsvField("x\ry")).toBe('"x\ry"');
    });
});

describe("buildTextFeatureCsv / TSV", () => {
    const full = [
        entry({}),
        entry({ term: "a,b", class: 'kelas "x"' }),
        entry({ term: "enak\tsekali", class: "neg", count: 0.5, log_weight: -2.5, probability: 0.082085, score: NaN }),
    ];

    it("header dan urutan kolom terkunci; escape koma/kutip benar", () => {
        const lines = buildTextFeatureCsv(full).split("\r\n");
        expect(lines[0]).toBe("term,class,count,log_weight,probability,score");
        expect(lines[1]).toBe("makan,pos,4,-0.875469,0.416667,1.321756");
        expect(lines[2]).toBe('"a,b","kelas ""x""",4,-0.875469,0.416667,1.321756');
        // nilai tak hingga/NaN -> sel kosong
        expect(lines[3]).toBe("enak\tsekali,neg,0.5,-2.5,0.082085,");
        expect(lines).toHaveLength(4);
    });

    it("berkas CSV diawali BOM UTF-8 (EF BB BF) dan mempertahankan karakter non-ASCII", () => {
        const file = buildTextFeatureCsvFile([entry({ term: "café" })]);
        expect(file.startsWith("﻿")).toBe(true);
        const bytes = Buffer.from(file, "utf8");
        expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
        expect(file).toContain("café,pos");
        // buildTextFeatureCsv sendiri tidak membawa BOM
        expect(buildTextFeatureCsv([entry({})]).startsWith("﻿")).toBe(false);
    });

    it("TSV: pemisah tab, tab/baris baru di dalam teks diganti spasi", () => {
        const lines = buildTextFeatureTsv(full).split("\n");
        expect(lines[0]).toBe("term\tclass\tcount\tlog_weight\tprobability\tscore");
        expect(lines[1]).toBe("makan\tpos\t4\t-0.875469\t0.416667\t1.321756");
        expect(lines[2]).toBe('a,b\tkelas "x"\t4\t-0.875469\t0.416667\t1.321756');
        expect(lines[3]).toBe("enak sekali\tneg\t0.5\t-2.5\t0.082085\t");
        expect(lines).toHaveLength(4);
    });

    it("tabel kosong: hanya header", () => {
        expect(buildTextFeatureCsv([])).toBe("term,class,count,log_weight,probability,score");
    });
});

describe("utf8ByteLength", () => {
    it("menghitung byte UTF-8 (1/2/3/4 byte)", () => {
        expect(utf8ByteLength("abc")).toBe(3);
        expect(utf8ByteLength("é")).toBe(2);
        expect(utf8ByteLength("€")).toBe(3);
        expect(utf8ByteLength("😀")).toBe(4);
        expect(utf8ByteLength("a😀é")).toBe(Buffer.byteLength("a😀é", "utf8"));
    });
});

describe("TextFeatureTableOutput", () => {
    beforeEach(() => jest.clearAllMocks());

    it("menampilkan tabel Top-k per kelas (Rank, Term, Score, Log weight, Count)", () => {
        const data = JSON.stringify({ textFeatureTable: tableOf([entry({})]) });
        render(<TextFeatureTableOutput data={data} />);
        const pos = screen.getByTestId("text-feature-class-pos");
        expect(pos).toHaveTextContent("makan");
        expect(pos).toHaveTextContent("1.3218");
        expect(pos).toHaveTextContent("-0.8755");
        expect(screen.getByTestId("text-feature-class-neg")).toHaveTextContent("tidak");
        ["Rank", "Term", "Score", "Log weight", "Count"].forEach((h) =>
            expect(screen.getAllByText(h).length).toBeGreaterThan(0)
        );
    });

    it("data tidak valid: pesan galat, tidak crash", () => {
        render(<TextFeatureTableOutput data="{bukan json" />);
        expect(screen.getByText(/cannot be displayed/i)).toBeInTheDocument();
    });

    it("Download CSV: nama default + isi ber-BOM dari tabel lengkap", () => {
        const onDownload = jest.fn();
        const full = [entry({}), entry({ term: "a,b" })];
        render(<TextFeatureTableOutput data={{ textFeatureTable: tableOf(full) }} onDownload={onDownload} />);
        fireEvent.click(screen.getByRole("button", { name: /download csv/i }));
        expect(onDownload).toHaveBeenCalledTimes(1);
        const [fileName, content] = onDownload.mock.calls[0];
        expect(fileName).toBe("Naive_Bayes_Text_Features.csv");
        expect(fileName).toBe(DEFAULT_TEXT_FEATURE_CSV_FILE_NAME);
        expect(content.startsWith("﻿")).toBe(true);
        expect(content).toBe(buildTextFeatureCsvFile(full));
    });

    it("Copy (TSV): menyalin TSV lengkap dan toast sukses bila <= 5 MB", async () => {
        const onCopy = jest.fn().mockResolvedValue(undefined);
        const full = [entry({}), entry({ term: "nasi" })];
        render(<TextFeatureTableOutput data={{ textFeatureTable: tableOf(full) }} onCopy={onCopy} />);
        fireEvent.click(screen.getByRole("button", { name: /copy \(tsv\)/i }));
        await waitFor(() => expect(onCopy).toHaveBeenCalledWith(buildTextFeatureTsv(full)));
        expect(toast.success).toHaveBeenCalled();
        expect(toast.warning).not.toHaveBeenCalled();
    });

    it("Copy (TSV) > 5 MB: toast saran Download CSV dan TIDAK menyalin", async () => {
        const onCopy = jest.fn();
        const term = "x".repeat(200);
        const full = Array.from({ length: 30000 }, (_, i) => entry({ term: `${term}${i}` }));
        expect(utf8ByteLength(buildTextFeatureTsv(full))).toBeGreaterThan(TEXT_FEATURE_COPY_LIMIT_BYTES);
        render(<TextFeatureTableOutput data={{ textFeatureTable: tableOf(full) }} onCopy={onCopy} />);
        fireEvent.click(screen.getByRole("button", { name: /copy \(tsv\)/i }));
        await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(TEXT_FEATURE_COPY_TOO_LARGE_MESSAGE));
        expect(TEXT_FEATURE_COPY_TOO_LARGE_MESSAGE).toBe("The table is too large to copy. Use Download CSV instead.");
        expect(onCopy).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it("kegagalan clipboard: toast galat", async () => {
        const onCopy = jest.fn().mockRejectedValue(new Error("ditolak"));
        render(<TextFeatureTableOutput data={{ textFeatureTable: tableOf([entry({})]) }} onCopy={onCopy} />);
        fireEvent.click(screen.getByRole("button", { name: /copy \(tsv\)/i }));
        await waitFor(() => expect(toast.error).toHaveBeenCalled());
    });

    it("tombol nonaktif bila tabel lengkap kosong", () => {
        render(<TextFeatureTableOutput data={{ textFeatureTable: tableOf([]) }} />);
        expect(screen.getByRole("button", { name: /download csv/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /copy \(tsv\)/i })).toBeDisabled();
    });
});
