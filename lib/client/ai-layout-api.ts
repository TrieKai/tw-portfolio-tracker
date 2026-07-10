import type {
  UiLayoutSuggestion,
  UiPreferences,
  UiTheme,
} from "@/lib/types/ui-preferences";

interface AiLayoutSuccess {
  success: true;
  data: UiLayoutSuggestion;
  provider?: "gemini" | "zhipu";
  fallbackUsed?: boolean;
}

interface AiLayoutError {
  success: false;
  error: string;
  code: string;
  suggestion?: string;
}

export async function requestAiLayout(
  prompt: string,
  theme: UiTheme,
  current: UiPreferences
): Promise<AiLayoutSuccess | AiLayoutError> {
  try {
    const response = await fetch("/api/ai/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // updatedAt 是本機／雲端同步用的中繼資料，不應送給模型或參與 API 驗證。
      body: JSON.stringify({
        prompt,
        current: {
          theme,
          palette: current.palette,
          density: current.density,
          cardStyle: current.cardStyle,
          dashboardLayout: current.dashboardLayout,
        },
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | AiLayoutSuccess
      | AiLayoutError
      | null;

    if (!data || typeof data !== "object" || !("success" in data)) {
      return {
        success: false,
        error: "AI 版面服務回傳了無法辨識的內容",
        code: "INVALID_RESPONSE",
      };
    }
    return data;
  } catch {
    return {
      success: false,
      error: "目前無法連線至 AI 版面服務",
      code: "NETWORK_ERROR",
      suggestion: "請確認網路後再試",
    };
  }
}
