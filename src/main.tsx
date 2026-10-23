import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installLogCapture } from "./lib/logs";

installLogCapture();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary what="o app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
