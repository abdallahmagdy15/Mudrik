import React, { Component } from "react";
import { t } from "@shared/i18n";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[RENDERER] Unhandled error:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const lang = (localStorage.getItem("mudrik-lang") as "en" | "ar") || "en";

    return (
      <div className="crash-screen" dir={lang === "ar" ? "rtl" : "ltr"}>
        <div className="crash-icon">&#9888;</div>
        <div className="crash-title">{t(lang, "somethingWentWrong")}</div>
        <div className="crash-desc">{t(lang, "errorDescription")}</div>
        <button className="crash-restart-btn" onClick={this.handleReload}>
          {t(lang, "restart")}
        </button>
      </div>
    );
  }
}
