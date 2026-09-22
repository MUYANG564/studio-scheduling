import { useState } from "react";
import writeExcelFile from "write-excel-file/browser";
import { api, ApiError } from "./api";
import { Button } from "./ui";

type Sheet = { name: string; columns: string[]; rows: string[][] };
type BackupResult = { filename: string; sheets: Sheet[] };

export function BackupButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  const exportExcel = async () => {
    setBusy(true);
    try {
      const result = (await api.post("backup/export")) as BackupResult;
      const workbook = result.sheets.map((sheet) => ({
        sheet: sheet.name,
        data: [sheet.columns, ...sheet.rows],
        stickyRowsCount: 1,
      }));
      await writeExcelFile(workbook).toFile(result.filename);
    } catch (error) {
      alert(error instanceof ApiError ? error.message : "导出失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button className={className} variant="outline" onClick={exportExcel} disabled={busy}>
      {busy ? "正在导出…" : "导出 Excel 备份"}
    </Button>
  );
}
