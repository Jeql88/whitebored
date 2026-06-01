import React, { Suspense, lazy } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Login from "./components/Auth/Login";
import Register from "./components/Auth/Register";
import WhiteboardHome from "./components/Whiteboard/WhiteboardHome";
import { ThemeProvider } from "./theme/ThemeContext";

// Excalidraw is a large dependency — lazy-load the editor so the dashboard and
// auth pages stay lightweight.
const WhiteboardEditor = lazy(() =>
  import("./components/Whiteboard/WhiteboardEditor")
);

function EditorFallback() {
  return (
    <div className="flex h-screen w-screen items-center justify-center text-[var(--surface-muted)]">
      Loading whiteboard…
    </div>
  );
}

export default function App() {
  const token = localStorage.getItem("token");

  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/whiteboards"
            element={token ? <WhiteboardHome /> : <Navigate to="/login" />}
          />
          <Route
            path="/whiteboard/:id"
            element={
              <Suspense fallback={<EditorFallback />}>
                <WhiteboardEditor />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={<Navigate to={token ? "/whiteboards" : "/login"} />}
          />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}
