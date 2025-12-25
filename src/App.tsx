import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';

const NEW_DOCUMENT_NAME = 'Documento sin título.txt';
const WORD_TARGET = 700;

const formatDateKey = (date: Date = new Date()) => date.toISOString().slice(0, 10);

const sanitizeDocumentName = (value: string) => {
  const withoutControl = Array.from(value)
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('');
  const cleaned = withoutControl.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ');
  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : '';
};

type DocumentMeta = {
  fileName: string;
  filePath: string | null;
};

const App = () => {
  const [isLocked, setIsLocked] = useState(true);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [documentMeta, setDocumentMeta] = useState<DocumentMeta>({
    fileName: NEW_DOCUMENT_NAME,
    filePath: null,
  });
  const [isDirty, setIsDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [streak, setStreak] = useState<SecurePadAuthStats>({
    currentStreak: 0,
    longestStreak: 0,
    lastCompletedDate: null,
  });
  const [hasCompletedGoalToday, setHasCompletedGoalToday] = useState(false);
  const [appVersion] = useState<string>(() =>
    typeof window === 'undefined' ? 'dev' : window.securePad?.version?.() ?? 'dev',
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const statusTimeoutRef = useRef<number | null>(null);
  const wordCount = useMemo(() => {
    const trimmed = editorValue.trim();
    if (!trimmed) {
      return 0;
    }
    return trimmed.split(/\s+/u).filter(Boolean).length;
  }, [editorValue]);
  const wordProgress = Math.min(1, wordCount / WORD_TARGET);
  const wordProgressPercent = Math.round(wordProgress * 100);
  const wordProgressDisplay = Math.min(100, wordProgressPercent);
  const wordsRemaining = Math.max(0, WORD_TARGET - wordCount);
  const reachedWordTarget = wordCount >= WORD_TARGET;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const loadUsers = async () => {
      try {
        const exists = await window.securePad?.auth?.hasUsers?.();
        if (typeof exists === 'boolean') {
          setHasUsers(exists);
          setAuthMode(exists ? 'login' : 'register');
        }
      } catch {
        setHasUsers(false);
        setAuthMode('register');
      }
    };
    void loadUsers();
  }, []);

  useEffect(
    () => () => {
      if (statusTimeoutRef.current !== null) {
        window.clearTimeout(statusTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isLocked) {
      const focusTimeout = window.setTimeout(() => textareaRef.current?.focus(), 250);
      const transitionTimeout = window.setTimeout(() => setIsUnlocking(false), 600);
      return () => {
        window.clearTimeout(focusTimeout);
        window.clearTimeout(transitionTimeout);
      };
    }
    return undefined;
  }, [isLocked]);

  useEffect(() => {
    const docTitle = `${documentMeta.fileName}${isDirty ? ' *' : ''} — SecurePad`;
    document.title = docTitle;
  }, [documentMeta.fileName, isDirty]);

  const showStatus = useCallback((message: string) => {
    setStatusMessage(message);
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = window.setTimeout(() => {
      setStatusMessage(null);
      statusTimeoutRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => {
    if (isLocked || hasCompletedGoalToday || wordCount < WORD_TARGET) {
      return;
    }

    let isMounted = true;
    const registerGoal = async () => {
      try {
        const updated = await window.securePad?.stats?.completeDailyGoal?.();
        if (!isMounted) {
          return;
        }
        if (updated) {
          setStreak(updated);
          setHasCompletedGoalToday(true);
          showStatus('Meta diaria alcanzada. ¡Excelente trabajo!');
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }
        console.error('Error al registrar meta diaria:', error);
        showStatus('No se pudo registrar la meta diaria');
      }
    };

    void registerGoal();

    return () => {
      isMounted = false;
    };
  }, [hasCompletedGoalToday, isLocked, showStatus, wordCount]);

  const updateCursorPosition = useCallback((value: string, caretIndex: number) => {
    const upToCaret = value.slice(0, caretIndex);
    const lines = upToCaret.split('\n');
    const line = lines.length;
    const column = (lines[lines.length - 1] ?? '').length + 1;
    setCursorPosition({ line, column });
  }, []);

  const resetDocumentState = useCallback(
    (content: string, metaOverride?: Partial<DocumentMeta>) => {
      if (metaOverride) {
        setDocumentMeta((prev) => ({
          fileName:
            metaOverride.fileName !== undefined
              ? sanitizeDocumentName(metaOverride.fileName) || NEW_DOCUMENT_NAME
              : prev.fileName,
          filePath: metaOverride.filePath !== undefined ? metaOverride.filePath : prev.filePath,
        }));
      }
      setEditorValue(content);
      setIsDirty(false);

      const caret = content.length;
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.setSelectionRange(caret, caret);
          updateCursorPosition(textarea.value, caret);
        } else {
          updateCursorPosition(content, caret);
        }
      });
    },
    [updateCursorPosition],
  );

  const handleSelectionUpdate = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caret = textarea.selectionStart ?? textarea.value.length;
    updateCursorPosition(textarea.value, caret);
  }, [updateCursorPosition]);

  const handleDocumentNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (isLocked) {
      return;
    }
    const value = sanitizeDocumentName(event.currentTarget.value);
    setDocumentMeta((prev) => {
      if (prev.fileName === value) {
        return prev;
      }
      return {
        fileName: value,
        filePath: prev.filePath,
      };
    });
    setIsDirty(true);
  };

  const handleSwitchAuthMode = useCallback(
    (mode: 'login' | 'register') => {
      if (authLoading) {
        return;
      }
      setAuthMode(mode);
      setAuthError(null);
      setHasError(false);
    },
    [authLoading],
  );

  const handleEditorChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.currentTarget;
    if (value !== editorValue) {
      setIsDirty(true);
    }
    setEditorValue(value);
    updateCursorPosition(value, selectionStart ?? value.length);
  };

  const handleAuthSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (authLoading) {
        return;
      }
      setAuthError(null);
      setHasError(false);

      const username = usernameInput.trim();
      const password = passwordInput;
      const confirmPassword = confirmPasswordInput;

      if (username.length < 3) {
        setAuthError('El usuario debe tener al menos 3 caracteres.');
        setHasError(true);
        window.setTimeout(() => setHasError(false), 600);
        return;
      }
      if (password.length < 8) {
        setAuthError('La contraseña debe tener al menos 8 caracteres.');
        setHasError(true);
        window.setTimeout(() => setHasError(false), 600);
        return;
      }
      if (authMode === 'register' && password !== confirmPassword) {
        setAuthError('Las contraseñas no coinciden.');
        setHasError(true);
        window.setTimeout(() => setHasError(false), 600);
        return;
      }

      const authMethod =
        authMode === 'register' ? window.securePad?.auth?.register : window.securePad?.auth?.login;

      if (!authMethod) {
        setAuthError('La autenticación no está disponible en este entorno.');
        setHasError(true);
        window.setTimeout(() => setHasError(false), 600);
        return;
      }

      try {
        setAuthLoading(true);
        const response = await authMethod({ username, password });
        const todayKey = formatDateKey();
        setIsUnlocking(true);
        setIsLocked(false);
        setAuthLoading(false);
        setAuthError(null);
        setHasError(false);
        setHasUsers(true);
        setCurrentUser(response.username);
        setStreak(response.stats);
        setHasCompletedGoalToday(response.stats.lastCompletedDate === todayKey);
        setUsernameInput('');
        setPasswordInput('');
        setConfirmPasswordInput('');
        resetDocumentState('', { fileName: NEW_DOCUMENT_NAME, filePath: null });
        setStatusMessage(null);
        showStatus(
          authMode === 'register'
            ? `Cuenta creada. ¡Bienvenido, ${response.username}!`
            : `Bienvenido, ${response.username}`,
        );
      } catch (error) {
        setAuthLoading(false);
        const message =
          error instanceof Error ? error.message : 'No se pudo completar la autenticación.';
        setAuthError(message);
        setHasError(true);
        window.setTimeout(() => setHasError(false), 600);
      }
    },
    [
      authLoading,
      authMode,
      confirmPasswordInput,
      resetDocumentState,
      showStatus,
      usernameInput,
      passwordInput,
    ],
  );

  const handleLock = useCallback(() => {
    void window.securePad?.auth?.logout?.();
    setIsLocked(true);
    setIsUnlocking(false);
    setHasError(false);
    setAuthError(null);
    setAuthLoading(false);
    setCurrentUser(null);
    setUsernameInput('');
    setPasswordInput('');
    setConfirmPasswordInput('');
    setStatusMessage(null);
    setStreak({
      currentStreak: 0,
      longestStreak: 0,
      lastCompletedDate: null,
    });
    setHasCompletedGoalToday(false);
    resetDocumentState('', { fileName: NEW_DOCUMENT_NAME, filePath: null });
    textareaRef.current?.blur();
    showStatus('Editor bloqueado');
  }, [resetDocumentState, showStatus]);

  const handleNewDocument = useCallback(() => {
    if (isLocked) {
      showStatus('Desbloquea para crear un documento');
      return;
    }
    if (isDirty) {
      const proceed = window.confirm('Tienes cambios sin guardar. ¿Deseas descartarlos y crear un nuevo documento?');
      if (!proceed) {
        return;
      }
    }
    resetDocumentState('', { fileName: NEW_DOCUMENT_NAME, filePath: null });
    showStatus('Nuevo documento');
    textareaRef.current?.focus();
  }, [isDirty, isLocked, resetDocumentState, showStatus]);

  const openDocument = useCallback(async () => {
    if (isLocked) {
      showStatus('Desbloquea para abrir archivos');
      return;
    }
    if (!window.securePad?.openFile) {
      showStatus('Abrir no está disponible en este entorno');
      return;
    }
    if (isDirty) {
      const proceed = window.confirm('Tienes cambios sin guardar. ¿Deseas descartarlos y abrir otro archivo?');
      if (!proceed) {
        return;
      }
    }
    try {
      const result = await window.securePad.openFile();
      if (!result) {
        showStatus('Apertura cancelada');
        return;
      }
      resetDocumentState(result.content, { fileName: result.fileName, filePath: result.filePath });
      showStatus(`Archivo cargado: ${result.fileName}`);
      textareaRef.current?.focus();
    } catch (error) {
      console.error('Error al abrir archivo:', error);
      showStatus('No se pudo abrir el archivo');
    }
  }, [isDirty, isLocked, resetDocumentState, showStatus]);

  const saveDocument = useCallback(
    async (options?: { forceSaveAs?: boolean }) => {
      if (isLocked) {
        showStatus('Desbloquea para guardar');
        return false;
      }
      if (!window.securePad?.saveFile) {
        showStatus('Guardado no disponible en este entorno');
        return false;
      }

      try {
        const effectiveFileName = sanitizeDocumentName(documentMeta.fileName) || NEW_DOCUMENT_NAME;
        const shouldAutoSave = !documentMeta.filePath && !(options?.forceSaveAs ?? false);
        const result = await window.securePad.saveFile({
          content: editorValue,
          filePath: options?.forceSaveAs ? null : documentMeta.filePath,
          forceSaveAs: options?.forceSaveAs ?? false,
          suggestedFileName: effectiveFileName,
          preferredFileName: effectiveFileName,
          autoSave: shouldAutoSave,
        });

        if (!result) {
          showStatus('Guardado cancelado');
          return false;
        }

        setDocumentMeta({
          fileName: result.fileName,
          filePath: result.filePath,
        });
        setIsDirty(false);
        showStatus(`Documento guardado: ${result.fileName}`);
        return true;
      } catch (error) {
        console.error('Error al guardar archivo:', error);
        showStatus('No se pudo guardar el archivo');
        return false;
      }
    },
    [documentMeta.fileName, documentMeta.filePath, editorValue, isLocked, showStatus],
  );

  const saveDocumentAs = useCallback(() => saveDocument({ forceSaveAs: true }), [saveDocument]);

  useEffect(() => {
    if (isLocked) {
      return undefined;
    }

    const listener = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const key = event.key.toLowerCase();
      const isAccel = event.ctrlKey || event.metaKey;

      if (!isAccel) {
        return;
      }

      if (key === 's' && event.shiftKey) {
        event.preventDefault();
        void saveDocumentAs();
      } else if (key === 's') {
        event.preventDefault();
        void saveDocument();
      } else if (key === 'o') {
        event.preventDefault();
        void openDocument();
      } else if (key === 'n') {
        event.preventDefault();
        handleNewDocument();
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handleNewDocument, isLocked, openDocument, saveDocument, saveDocumentAs]);

  useEffect(() => {
    const unsubscribe = window.securePad?.onAction?.((action) => {
      switch (action) {
        case 'new':
          handleNewDocument();
          break;
        case 'open':
          void openDocument();
          break;
        case 'save':
          void saveDocument();
          break;
        case 'saveAs':
          void saveDocumentAs();
          break;
        default:
          break;
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [handleNewDocument, openDocument, saveDocument, saveDocumentAs]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const lineCount = useMemo(() => editorValue.split('\n').length, [editorValue]);
  const lineLabel = lineCount === 1 ? 'línea' : 'líneas';
  const actionsDisabled = isLocked;
  const displayFileName =
    documentMeta.fileName && documentMeta.fileName.length > 0
      ? documentMeta.fileName
      : NEW_DOCUMENT_NAME;
  const documentStatusLabel = isDirty ? ' • sin guardar' : documentMeta.filePath ? ' • guardado' : '';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface text-slate-100">
      <header
        className="flex flex-wrap items-center gap-6 border-b border-white/5 bg-surface-muted/80 px-6 py-4 text-sm backdrop-blur"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div className="flex items-start gap-3" style={{ WebkitAppRegion: 'no-drag' }}>
          <div className="flex h-10 w-10 items-center justify-center rounded bg-accent/20 text-lg text-accent">
            🔒
          </div>
          <div className="flex w-full max-w-xs flex-col gap-2 leading-tight sm:max-w-sm">
      <div>
              <p className="text-sm font-semibold text-slate-100">
                SecurePad
                <span className="ml-2 text-xs font-normal text-slate-500">v{appVersion}</span>
              </p>
              <p className="text-xs text-slate-500">
                {currentUser ? `Usuario: ${currentUser}` : 'Sin sesión activa'}
              </p>
            </div>
            <div className="flex flex-col gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
              <input
                type="text"
                value={documentMeta.fileName}
                onChange={handleDocumentNameChange}
                placeholder="Nombre del documento"
                disabled={isLocked}
                className="w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-accent focus:bg-white/10 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <span className="text-[11px] text-slate-500">
                {displayFileName}
                {documentStatusLabel}
              </span>
            </div>
          </div>
        </div>

        <div
          className="flex flex-1 flex-wrap items-center gap-3 md:justify-center"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <button
            type="button"
            onClick={handleNewDocument}
            disabled={actionsDisabled}
            title="Ctrl + N"
            className="rounded bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
          >
            Nuevo
          </button>
          <button
            type="button"
            onClick={() => {
              void openDocument();
            }}
            disabled={actionsDisabled}
            title="Ctrl + O"
            className="rounded bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
          >
            Abrir
          </button>
          <button
            type="button"
            onClick={() => {
              void saveDocument();
            }}
            disabled={actionsDisabled || !isDirty}
            title="Ctrl + S"
            className="rounded bg-accent px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={() => {
              void saveDocumentAs();
            }}
            disabled={actionsDisabled}
            title="Ctrl + Shift + S"
            className="rounded bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
          >
            Guardar como
          </button>
          <div className="flex w-full flex-col gap-2 border border-white/5 bg-white/5 px-4 py-3 text-left text-xs text-slate-200 sm:w-auto sm:min-w-[220px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-100">
                {wordCount.toLocaleString('es-ES')} palabras
              </span>
              <span className="text-[11px] uppercase tracking-widest text-slate-500">
                Meta {WORD_TARGET}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-900/60">
              <div
                className={`h-full rounded-full ${reachedWordTarget ? 'bg-emerald-400' : 'bg-accent'}`}
                style={{ width: `${wordProgressDisplay}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>{reachedWordTarget ? '🎯 Meta alcanzada' : `Faltan ${wordsRemaining.toLocaleString('es-ES')}`}</span>
              <span>{wordProgressDisplay}%</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>
                Racha: {streak.currentStreak.toLocaleString('es-ES')}{' '}
                {streak.currentStreak === 1 ? 'día' : 'días'}
              </span>
              <span>
                Mejor: {streak.longestStreak.toLocaleString('es-ES')}{' '}
                {streak.longestStreak === 1 ? 'día' : 'días'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              {hasCompletedGoalToday
                ? 'Meta diaria completada hoy.'
                : 'Alcanza 700 palabras para mantener la racha.'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' }}>
          <span className="text-xs uppercase tracking-widest text-slate-500">
            {isLocked ? 'Bloqueado' : 'Desbloqueado'}
          </span>
          <button
            type="button"
            onClick={handleLock}
            disabled={isLocked}
            className="rounded bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-100 backdrop-blur transition hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
          >
            Bloquear
          </button>
        </div>
      </header>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        <textarea
          ref={textareaRef}
          value={editorValue}
          onChange={handleEditorChange}
          onSelect={handleSelectionUpdate}
          onKeyUp={handleSelectionUpdate}
          onClick={handleSelectionUpdate}
          placeholder="Empieza a escribir en tu bloc seguro..."
          spellCheck={false}
          className="flex-1 resize-none border-none bg-transparent px-8 py-6 text-base leading-relaxed text-slate-100 outline-none placeholder:text-slate-600 selection:bg-accent/40"
        />

          <footer className="border-t border-white/5 bg-white/5 px-6 py-3 text-xs text-slate-400 backdrop-blur">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Línea {cursorPosition.line} · Columna {cursorPosition.column} · {lineCount} {lineLabel} · Palabras{' '}
                {wordCount.toLocaleString('es-ES')}
              </span>
              <span className="text-slate-500">
                {statusMessage ?? documentMeta.filePath ?? 'Documento sin guardar'}
              </span>
            </div>
          </footer>

          <div
            className={`absolute inset-0 z-10 transition-opacity duration-500 ${
              isLocked ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
            } ${!isLocked && !isUnlocking ? 'hidden' : ''}`}
          >
            <div className="flex h-full w-full items-center justify-center bg-slate-950/85 backdrop-blur-3xl">
            <div
              className={`w-full max-w-sm border border-white/5 bg-surface/90 p-8 text-left shadow-floating transition-all duration-500 ${
                  hasError ? 'animate-shake border-red-500/40' : ''
                }`}
              >
                <h2 className="text-lg font-semibold text-slate-100">Bienvenido a SecurePad</h2>
                <p className="mt-2 text-sm text-slate-400">
                  {hasUsers === false
                    ? 'Crea tu cuenta para empezar a escribir con seguridad.'
                    : 'Inicia sesión o crea una cuenta nueva para continuar.'}
                </p>
                <div className="mt-6 space-y-4">
                  {hasUsers ? (
                    <div className="flex rounded bg-white/10 p-1 text-xs font-semibold text-slate-300">
                      <button
                        type="button"
                        onClick={() => handleSwitchAuthMode('login')}
                        disabled={authLoading}
                        className={`flex-1 rounded px-3 py-1 transition focus:outline-none ${
                          authMode === 'login'
                            ? 'bg-white text-slate-900 shadow'
                            : 'text-slate-300 hover:bg-white/15'
                        }`}
                      >
                        Iniciar sesión
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSwitchAuthMode('register')}
                        disabled={authLoading}
                        className={`flex-1 rounded px-3 py-1 transition focus:outline-none ${
                          authMode === 'register'
                            ? 'bg-white text-slate-900 shadow'
                            : 'text-slate-300 hover:bg-white/15'
                        }`}
                      >
                        Crear cuenta
                      </button>
      </div>
                  ) : null}
                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      void handleAuthSubmit(event);
                    }}
                  >
                    <input
                      type="text"
                      value={usernameInput}
                      onChange={(event) => {
                        setUsernameInput(event.currentTarget.value);
                        if (hasError) setHasError(false);
                        if (authError) setAuthError(null);
                      }}
                      placeholder="Usuario"
                      autoFocus
                      className="w-full rounded border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 transition focus:border-accent focus:bg-white/5 focus:outline-none"
                    />
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(event) => {
                        setPasswordInput(event.currentTarget.value);
                        if (hasError) setHasError(false);
                        if (authError) setAuthError(null);
                      }}
                      placeholder="Contraseña"
                      className="w-full rounded border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 transition focus:border-accent focus:bg-white/5 focus:outline-none"
                    />
                    {authMode === 'register' && (
                      <input
                        type="password"
                        value={confirmPasswordInput}
                        onChange={(event) => {
                          setConfirmPasswordInput(event.currentTarget.value);
                          if (hasError) setHasError(false);
                          if (authError) setAuthError(null);
                        }}
                        placeholder="Confirmar contraseña"
                        className="w-full rounded border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 transition focus:border-accent focus:bg-white/5 focus:outline-none"
                      />
                    )}
                    {authError && (
                      <p className="text-xs font-semibold text-red-400">{authError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full rounded bg-accent px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-accent-soft focus:bg-accent-soft focus:outline-none disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
                    >
                      {authLoading
                        ? 'Procesando...'
                        : authMode === 'register'
                          ? 'Crear cuenta'
                          : 'Entrar'}
        </button>
                  </form>
                  <p className="text-center text-[11px] text-slate-600">
                    v{appVersion} • Tus credenciales cifran tus documentos
        </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
};

export default App;

