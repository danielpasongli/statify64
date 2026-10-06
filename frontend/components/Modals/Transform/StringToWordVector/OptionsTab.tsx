import React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { INDONESIAN_STOPWORDS, ENGLISH_STOPWORDS } from "./constants/stopwords";
import {
  FORMULA_STANDARDS,
  FORMULA_STANDARD_ORDER,
  isFormulaStandard,
  type FormulaOption,
} from "./constants/formula-standards";
import { applyFormulaStandard, type StwvConfig } from "./config";
import type { StemmingMethod, StopwordsMethod, TokenizerType } from "./types";

/**
 * Props sengaja hanya bergantung pada tipe config (bukan hook) agar komponen
 * ini bisa dipakai ulang di tab Text Preprocessing Naive Bayes v2.
 */
interface OptionsTabProps {
  config: StwvConfig;
  setConfig: React.Dispatch<React.SetStateAction<StwvConfig>>;
  /**
   * Opsional: bila diberikan, bagian "Vector Column Name" tampil di paling atas.
   * Tidak diberikan (mis. di Naive Bayes v2) → bagian itu tidak dirender.
   */
  columnPrefix?: string;
  setColumnPrefix?: (value: string) => void;
  /** Pesan validasi awalan (null = sah). */
  columnPrefixError?: string | null;
}

const NGRAM_MIN_LIMIT = 1;
const NGRAM_MAX_LIMIT = 5;

/** Mengembalikan `value` bila termasuk `allowed`, selain itu undefined (pengganti cast). */
function pickAllowed<T extends string>(allowed: readonly T[], value: string): T | undefined {
  return allowed.find((a) => a === value);
}

/** Clamp ukuran n-gram ke 1..5 (F19); input tidak valid menjadi 1. */
function clampNgramSize(raw: string): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) return NGRAM_MIN_LIMIT;
  return Math.min(NGRAM_MAX_LIMIT, Math.max(NGRAM_MIN_LIMIT, n));
}

/**
 * Mengubah teks input angka menjadi number apa adanya (tanpa dibulatkan) supaya
 * nilai tidak sah (mis. 1.5 atau -1) ditangkap validateStwvConfig, bukan diam-diam diubah.
 * Input kosong menjadi 0.
 */
function parseNumberInput(raw: string): number {
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : n;
}

const STOPWORDS_METHODS: readonly StopwordsMethod[] = ["none", "indonesian", "english", "custom"];
const STEMMING_METHODS: readonly StemmingMethod[] = ["none", "indonesian", "english"];
const TOKENIZER_TYPES: readonly TokenizerType[] = ["word", "ngram"];

export const OptionsTab: React.FC<OptionsTabProps> = ({
  config,
  setConfig,
  columnPrefix,
  setColumnPrefix,
  columnPrefixError = null,
}) => {
  const standard = FORMULA_STANDARDS[config.formulaStandard];

  const renderOptions = <T extends string>(
    idPrefix: string,
    options: readonly FormulaOption<T>[],
    onSelect: (value: T) => void,
    currentValue: T,
  ) => (
    <RadioGroup
      value={currentValue}
      onValueChange={(val) => {
        const picked = pickAllowed(options.map((o) => o.value), val);
        if (picked !== undefined) onSelect(picked);
      }}
      className="grid grid-cols-2 gap-2 pt-1"
    >
      {options.map((opt) => (
        <div key={opt.value} className="flex items-center space-x-2" title={opt.formula}>
          <RadioGroupItem value={opt.value} id={`${idPrefix}-${opt.value}`} />
          <Label htmlFor={`${idPrefix}-${opt.value}`} className="font-normal cursor-pointer text-sm">
            {opt.label}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );

  return (
    <div className="flex flex-col h-full z-0">
      <ScrollArea className="h-full pr-4">
        <div className="space-y-8 pb-8 pt-4">

          {/* Vector Column Name */}
          {columnPrefix !== undefined && setColumnPrefix && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Vector Column Name</h3>
              <Input
                id="stwv-column-prefix"
                value={columnPrefix}
                onChange={(e) => setColumnPrefix(e.target.value)}
                maxLength={32}
                aria-invalid={columnPrefixError !== null}
                className={columnPrefixError ? "border-destructive" : ""}
                placeholder="VEC_"
              />
              {columnPrefixError ? (
                <p className="text-xs text-destructive">{columnPrefixError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Column name = prefix + term, e.g. <span className="font-mono">{columnPrefix}word</span>.
                </p>
              )}
            </div>
          )}

          {/* Text Preprocessing */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Text Preprocessing</h3>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="lowercase"
                checked={config.lowercase}
                onCheckedChange={(checked) =>
                  setConfig((prev) => ({ ...prev, lowercase: checked === true }))
                }
              />
              <Label htmlFor="lowercase" className="text-sm font-normal cursor-pointer">
                Lowercase
              </Label>
            </div>
          </div>

          {/* Stopwords Removal */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Stopwords Removal</h3>
            <RadioGroup
              value={config.stopwords.method}
              onValueChange={(val) => {
                const method = pickAllowed(STOPWORDS_METHODS, val);
                if (method === undefined) return;
                setConfig((prev) => ({ ...prev, stopwords: { ...prev.stopwords, method } }));
              }}
              className="flex w-full space-x-8"
            >
              {/* Kiri: Pilihan Standar */}
              <div className="flex flex-col space-y-3 pt-1">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="none" id="sw-none" />
                  <Label htmlFor="sw-none" className="font-normal cursor-pointer">None</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="indonesian" id="sw-id" />
                  <Label htmlFor="sw-id" className="font-normal cursor-pointer">Indonesian</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="english" id="sw-en" />
                  <Label htmlFor="sw-en" className="font-normal cursor-pointer">English</Label>
                </div>
              </div>

              {/* Kanan: Custom dan Textarea */}
              <div className="flex flex-col w-full max-w-sm space-y-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="custom" id="sw-custom" />
                  <Label htmlFor="sw-custom" className="font-normal cursor-pointer">Custom</Label>
                </div>
                <Textarea
                  value={
                    config.stopwords.method === "none" ? "" :
                    config.stopwords.method === "indonesian" ? INDONESIAN_STOPWORDS.join("\n") :
                    config.stopwords.method === "english" ? ENGLISH_STOPWORDS.join("\n") :
                    config.stopwords.customList
                  }
                  onChange={(e) => {
                    const customList = e.target.value;
                    setConfig((prev) => ({
                      ...prev,
                      stopwords: {
                        ...prev.stopwords,
                        method: "custom",
                        customList,
                      },
                    }));
                  }}
                  placeholder={config.stopwords.method === "none" ? "Type words here to create a custom stopword list..." : "Enter stopwords, one per line..."}
                  className="h-32 text-sm"
                />
              </div>
            </RadioGroup>
          </div>

          {/* Stemming */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Stemming</h3>
            <RadioGroup
              value={config.stemming.method}
              onValueChange={(val) => {
                const method = pickAllowed(STEMMING_METHODS, val);
                if (method === undefined) return;
                setConfig((prev) => ({ ...prev, stemming: { ...prev.stemming, method } }));
              }}
              className="flex flex-col space-y-1"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="none" id="stem-none" />
                <Label htmlFor="stem-none" className="font-normal cursor-pointer">None</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="indonesian" id="stem-id" />
                <Label htmlFor="stem-id" className="font-normal cursor-pointer">Indonesian (Sastrawi)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="english" id="stem-en" />
                <Label htmlFor="stem-en" className="font-normal cursor-pointer">English (Porter)</Label>
              </div>
            </RadioGroup>
            {/* F12: stemmer selalu lowercase */}
            <p className="text-[10px] text-muted-foreground">
              Stemming always converts tokens to lowercase, so the Lowercase option has no effect while stemming is on.
            </p>
          </div>

          {/* Tokenizer & Delimiters */}
          <div className="space-y-4">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Tokenizer</h3>
              <RadioGroup
                value={config.tokenizer.type}
                onValueChange={(val) => {
                  const type = pickAllowed(TOKENIZER_TYPES, val);
                  if (type === undefined) return;
                  setConfig((prev) => ({ ...prev, tokenizer: { ...prev.tokenizer, type } }));
                }}
                className="flex flex-col space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="word" id="tok-word" />
                  <Label htmlFor="tok-word" className="font-normal cursor-pointer">Word</Label>
                </div>
                <div className="flex items-center space-x-2 h-8">
                  <RadioGroupItem value="ngram" id="tok-ngram" />
                  <Label htmlFor="tok-ngram" className="font-normal cursor-pointer pr-2">N-gram</Label>
                  {/* Inline min/max size (di-clamp 1..5, F19) */}
                  <div className={`flex items-center space-x-2 transition-opacity ${config.tokenizer.type === "ngram" ? "opacity-100" : "opacity-50 pointer-events-none"}`}>
                    <Label htmlFor="ngram-max" className="text-xs text-muted-foreground">max size</Label>
                    <Input
                      id="ngram-max"
                      type="number"
                      min={NGRAM_MIN_LIMIT}
                      max={NGRAM_MAX_LIMIT}
                      className="w-16 h-7 text-xs px-2"
                      value={config.tokenizer.maxSize}
                      onChange={(e) => {
                        const maxSize = clampNgramSize(e.target.value);
                        setConfig((prev) => ({ ...prev, tokenizer: { ...prev.tokenizer, maxSize } }));
                      }}
                    />
                    <Label htmlFor="ngram-min" className="text-xs text-muted-foreground ml-2">min size</Label>
                    <Input
                      id="ngram-min"
                      type="number"
                      min={NGRAM_MIN_LIMIT}
                      max={NGRAM_MAX_LIMIT}
                      className="w-16 h-7 text-xs px-2"
                      value={config.tokenizer.minSize}
                      onChange={(e) => {
                        const minSize = clampNgramSize(e.target.value);
                        setConfig((prev) => ({ ...prev, tokenizer: { ...prev.tokenizer, minSize } }));
                      }}
                    />
                  </div>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2 max-w-xs pt-1">
              <Label htmlFor="delimiters" className="text-sm font-semibold">Delimiters</Label>
              <Input
                id="delimiters"
                value={config.delimiters}
                onChange={(e) => {
                  const delimiters = e.target.value;
                  setConfig((prev) => ({ ...prev, delimiters }));
                }}
                className="h-9 text-sm font-mono"
              />
            </div>
          </div>

          {/* Vectorization Method */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Vectorization Method</h3>

            {/* Formula standard (preset) */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Formula standard</Label>
              <RadioGroup
                value={config.formulaStandard}
                onValueChange={(val) => {
                  if (isFormulaStandard(val)) {
                    setConfig((prev) => applyFormulaStandard(prev, val));
                  }
                }}
                className="flex flex-row space-x-6 pt-1"
              >
                {FORMULA_STANDARD_ORDER.map((id) => (
                  <div key={id} className="flex items-center space-x-2" title={FORMULA_STANDARDS[id].description}>
                    <RadioGroupItem value={id} id={`std-${id}`} />
                    <Label htmlFor={`std-${id}`} className="font-normal cursor-pointer text-sm">
                      {FORMULA_STANDARDS[id].label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <p className="text-[10px] text-muted-foreground">{standard.description}</p>
            </div>

            {/* Term Frequency (TF) */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Term Frequency (TF)</Label>
              {renderOptions(
                "tf",
                standard.tfOptions,
                (tfMethod) => setConfig((prev) => ({ ...prev, vectorization: { ...prev.vectorization, tfMethod } })),
                config.vectorization.tfMethod,
              )}
            </div>

            {/* Inverse Document Frequency (IDF) */}
            <div className="space-y-2 pt-2">
              <Label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Inverse Document Frequency (IDF)</Label>
              {renderOptions(
                "idf",
                standard.idfOptions,
                (idfMethod) => setConfig((prev) => ({ ...prev, vectorization: { ...prev.vectorization, idfMethod } })),
                config.vectorization.idfMethod,
              )}
            </div>

            {/* Normalization */}
            <div className="space-y-2 pt-2">
              <Label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Normalization</Label>
              {renderOptions(
                "norm",
                standard.normOptions,
                (normalization) => setConfig((prev) => ({ ...prev, vectorization: { ...prev.vectorization, normalization } })),
                config.vectorization.normalization,
              )}
            </div>
          </div>

          {/* Words to Keep */}
          <div className="space-y-2 max-w-xs pt-1">
            <Label htmlFor="words-to-keep" className="text-sm font-semibold">Words to Keep</Label>
            <Input
              id="words-to-keep"
              type="number"
              min={0}
              step={1}
              value={config.wordsToKeep}
              onChange={(e) => {
                const wordsToKeep = parseNumberInput(e.target.value);
                setConfig((prev) => ({ ...prev, wordsToKeep }));
              }}
              className="h-9 text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              0 = keep all words.{" "}
              {config.formulaStandard === "custom"
                ? "Words are ranked by the sum of TF × IDF."
                : "Words are ranked by total word count across all documents."}
            </p>
          </div>

          {/* Min term frequency */}
          <div className="space-y-2 max-w-xs pt-1">
            <Label htmlFor="min-term-freq" className="text-sm font-semibold">Min term frequency</Label>
            <Input
              id="min-term-freq"
              type="number"
              min={1}
              step={1}
              value={config.minTermFreq}
              onChange={(e) => {
                const minTermFreq = parseNumberInput(e.target.value);
                setConfig((prev) => ({ ...prev, minTermFreq }));
              }}
              className="h-9 text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Words whose total count across all documents is below this value are dropped before Words to Keep is applied.
            </p>
          </div>

        </div>
      </ScrollArea>
    </div>
  );
};
