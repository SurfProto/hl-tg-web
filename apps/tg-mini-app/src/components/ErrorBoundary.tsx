import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../lib/i18n';
import { log } from '../lib/logger';
import { reportClientError, toReportableError } from '../lib/error-reporting';
import { teardownStartupShell } from '../lib/startup';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : i18n.t('errors.unexpected');
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Uncover the screen before anything else.
    //
    // #startup-shell is opaque and sits at z-index 9999, and the only thing
    // that removes it is StartupShellController — which lives inside the tree
    // this boundary has just replaced, so on a crash during startup it can
    // never run. The fallback below was being painted underneath the splash,
    // which is why a crash in that window has always presented as a frozen
    // spinner with no error and no reload button. Crashes after startup were
    // unaffected: teardownStartupShell ends in .remove(), so by then there is
    // nothing left to hide. Idempotent, hence unconditional here.
    teardownStartupShell();

    log.error('[ErrorBoundary] caught error', {
      error,
      componentStack: info.componentStack,
    });

    const { message, stack } = toReportableError(error);
    reportClientError({
      kind: 'error-boundary',
      message,
      stack,
      componentStack: info.componentStack,
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="tg-root-height bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-lg font-semibold text-foreground">
            {i18n.t('errors.somethingWentWrong')}
          </p>
          {/*
            errorMessage is a raw exception string — "a is not a function" and
            the like. componentDidCatch already sends it to the log and to
            /api/client-errors, which is where it is useful; on screen it tells
            a user nothing and reads as a crash. Kept in dev because that is
            where it saves a round trip to the console.

            import.meta.env.DEV is replaced with the literal false in a
            production build, so this branch is removed by dead-code
            elimination rather than merely skipped.
          */}
          {import.meta.env.DEV && this.state.errorMessage && (
            <p className="max-w-xs font-mono text-xs text-muted">{this.state.errorMessage}</p>
          )}
          <button className="editorial-button-primary" onClick={this.handleReload}>
            {i18n.t('errors.reloadApp')}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
