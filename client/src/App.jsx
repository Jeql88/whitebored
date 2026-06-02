import React, { Suspense, lazy } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { useSession } from "./lib/auth-client";
import Login from "./components/Auth/Login";
import Register from "./components/Auth/Register";
import ForgotPassword from "./components/Auth/ForgotPassword";
import ResetPassword from "./components/Auth/ResetPassword";
import AccountSettings from "./components/Auth/AccountSettings";
import WhiteboardHome from "./components/Whiteboard/WhiteboardHome";
import { ThemeProvider } from "./theme/ThemeContext";

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

function Protected({ children }) {
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  return session ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot" element={<ForgotPassword />} />
          <Route path="/reset" element={<ResetPassword />} />
          <Route
            path="/whiteboards"
            element={<Protected><WhiteboardHome /></Protected>}
          />
          <Route
            path="/account"
            element={<Protected><AccountSettings /></Protected>}
          />
          <Route
            path="/whiteboard/:id"
            element={
              <Protected>
                <Suspense fallback={<EditorFallback />}>
                  <WhiteboardEditor />
                </Suspense>
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/whiteboards" />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}
