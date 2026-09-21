import { useState } from "react";
import { api, ApiError } from "./api";
import { Button } from "./ui";

export function BackupButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [documentUrl, setDocumentUrl] = useState("");

  const createBackup = async () => {
    const opened = window.open("about:blank", "_blank");
    setBusy(true);
    setDocumentUrl("");
    try {
      const result = await api.post("backup/dingtalk");
      setDocumentUrl(result.url);
      if (opened) opened.location.href = result.url;
    } catch (error) {
      opened?.close();
      alert(error instanceof ApiError ? error.message : "备份失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button className={className} variant="outline" onClick={createBackup} disabled={busy}>
        {busy ? "正在生成…" : "备份到钉钉文档"}
      </Button>
      {documentUrl && <a className="text-xs underline" href={documentUrl} target="_blank" rel="noreferrer">打开刚创建的备份</a>}
    </div>
  );
}
