/** 使用者選擇「只存本機」後，保留原有鍵名以延續既有選擇。 */
function dismissKey(userId: string): string {
  return `portfolio-upload-dismissed:${userId}`;
}

export function isUploadPromptDismissed(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(dismissKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function setUploadPromptDismissed(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(dismissKey(userId), "1");
  } catch {
    // 無法寫入時，同一登入階段仍由記憶體維持本機模式。
  }
}

export function clearUploadPromptDismissed(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(dismissKey(userId));
  } catch {
    // 已確認的同步仍可在目前登入階段執行。
  }
}
