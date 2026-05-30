/** 使用者曾選擇「暫不上傳」時記於 localStorage，避免每次重整都跳出詢問 */
function dismissKey(userId: string): string {
  return `portfolio-upload-dismissed:${userId}`;
}

export function isUploadPromptDismissed(userId: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(dismissKey(userId)) === "1";
}

export function setUploadPromptDismissed(userId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(dismissKey(userId), "1");
}

export function clearUploadPromptDismissed(userId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(dismissKey(userId));
}
