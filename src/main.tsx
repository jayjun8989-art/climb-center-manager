import { Component, type ErrorInfo, type ReactNode } from "react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { formatAppError, showFatalError } from "./utils/errors";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("React render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: "2rem",
            fontFamily: '"Malgun Gothic", "Segoe UI", "Apple SD Gothic Neo", sans-serif',
            background: "#0f172a",
            color: "#e2e8f0",
          }}
        >
          <div style={{ maxWidth: 640 }}>
            <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
              화면을 불러오지 못했습니다
            </h1>
            <p style={{ marginBottom: "1rem", color: "#94a3b8" }}>
              React 렌더링 중 오류가 발생했습니다. 아래 내용을 확인해주세요.
            </p>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "#111827",
                border: "1px solid #334155",
                borderRadius: "12px",
                padding: "1rem",
                fontSize: "0.875rem",
              }}
            >
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

let fatalErrorShown = false;

function isAppMounted() {
  const root = document.getElementById("root");
  return Boolean(root && root.childElementCount > 0);
}

function reportFatalError(title: string, error: unknown) {
  if (fatalErrorShown || isAppMounted()) return;
  fatalErrorShown = true;
  showFatalError(title, formatAppError(error));
}

window.addEventListener("error", (event) => {
  reportFatalError("예기치 않은 오류가 발생했습니다", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  reportFatalError("처리되지 않은 비동기 오류", event.reason);
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  reportFatalError("앱 초기화 실패", 'Root element "#root" not found in index.html');
} else {
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  } catch (error) {
    reportFatalError("앱 초기화 실패", error);
  }
}
