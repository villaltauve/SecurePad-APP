export {};

declare global {
  type SecurePadAction = 'new' | 'open' | 'save' | 'saveAs';

  interface SecurePadOpenResult {
    content: string;
    filePath: string;
    fileName: string;
  }

  interface SecurePadSaveOptions {
    content: string;
    filePath?: string | null;
    forceSaveAs?: boolean;
    suggestedFileName?: string;
    autoSave?: boolean;
    preferredFileName?: string;
  }

  interface SecurePadSaveResult {
    filePath: string;
    fileName: string;
  }

  interface SecurePadAuthStats {
    currentStreak: number;
    longestStreak: number;
    lastCompletedDate: string | null;
  }

  interface SecurePadAuthResponse {
    username: string;
    stats: SecurePadAuthStats;
  }

  interface Window {
    securePad?: {
      version: () => string;
      openFile?: () => Promise<SecurePadOpenResult | null>;
      saveFile?: (options: SecurePadSaveOptions) => Promise<SecurePadSaveResult | null>;
      onAction?: (callback: (action: SecurePadAction) => void) => (() => void) | void;
      auth?: {
        hasUsers?: () => Promise<boolean>;
        register?: (payload: { username: string; password: string }) => Promise<SecurePadAuthResponse>;
        login?: (payload: { username: string; password: string }) => Promise<SecurePadAuthResponse>;
        logout?: () => Promise<void>;
      };
      stats?: {
        completeDailyGoal?: () => Promise<SecurePadAuthStats>;
      };
    };
  }
}


