import { useResultStore } from "@/stores/useResultStore";
import type { StwvOutput } from "./buildStwvOutput";

/**
 * Menulis hasil proses STWV ke Output Viewer: satu log, satu analytic, lalu
 * ringkasan teks dan tiap tabel sebagai statistic. Nama komponen tabel tidak
 * terdaftar di registry khusus sehingga dirender oleh DataTableRenderer generik.
 */
export async function writeStwvOutput(output: StwvOutput): Promise<void> {
    const { addLog, addAnalytic, addStatistic } = useResultStore.getState();

    const logId = await addLog({ log: output.logText });
    const analyticId = await addAnalytic(logId, { title: "String to Word Vector", note: "" });

    await addStatistic(analyticId, {
        title: "String to Word Vector",
        output_data: JSON.stringify({ text: [{ text: output.summaryText }] }),
        components: "Executed",
        description: output.summaryDescription,
    });

    for (const table of output.tables) {
        await addStatistic(analyticId, {
            title: table.title,
            // Interpretasi otomatis; bila tidak ada (kunci tak dikenal) jatuh ke judul tabel
            description: output.tableDescriptions[table.key] ?? table.title,
            output_data: JSON.stringify({ tables: [table] }),
            components: `String to Word Vector ${table.title}`,
        });
    }
}
