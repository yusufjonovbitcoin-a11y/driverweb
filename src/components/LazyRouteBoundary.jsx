import React from 'react';
import { RotateCcw } from 'lucide-react';
import { withTranslation } from 'react-i18next';
import { isPageModuleLoadError } from './routeErrorModel.js';

class LazyRouteBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { t } = this.props;
    const moduleError = isPageModuleLoadError(this.state.error);

    return (
      <div className="grid min-h-56 place-items-center p-6">
        <div role="alert" className="max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm dark:border-amber-900 dark:bg-zinc-900">
          <h2 className="text-base font-black text-zinc-900 dark:text-white">
            {t(moduleError ? 'errors.moduleTitle' : 'errors.pageTitle')}
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            {t(moduleError ? 'errors.moduleHint' : 'errors.pageHint')}
          </p>
          <button
            type="button"
            onClick={() => moduleError ? window.location.reload() : this.setState({ error: null })}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-zinc-900"
          >
            <RotateCcw className="h-4 w-4" />
            {t(moduleError ? 'errors.reload' : 'errors.retryPage')}
          </button>
        </div>
      </div>
    );
  }
}

const TranslatedLazyRouteBoundary = withTranslation()(LazyRouteBoundary);

export default TranslatedLazyRouteBoundary;
