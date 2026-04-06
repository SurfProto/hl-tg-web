import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../lib/i18n';

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
    // Log for debugging — replace with a real error tracker (Sentry, etc.) when available
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-lg font-semibold text-foreground">
            {i18n.t('errors.somethingWentWrong')}
          </p>
          {this.state.errorMessage && (
            <p className="text-sm text-muted-foreground max-w-xs">{this.state.errorMessage}</p>
          )}
          <button
            className="px-6 py-2 bg-blue-500 text-white rounded-full text-sm font-medium"
            onClick={this.handleReload}
          >
            {i18n.t('errors.reloadApp')}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
