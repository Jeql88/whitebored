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
import VerifyEmail from "./components/Auth/VerifyEmail";
import AccountSettings from "./components/Auth/AccountSettings";
import WhiteboardHome from "./components/Whiteboard/WhiteboardHome";
import AdminLayout, { AdminRoute } from "./components/Admin/AdminLayout";
import AdminStats from "./components/Admin/AdminStats";
import AdminUsers from "./components/Admin/AdminUsers";
import AdminBoards from "./components/Admin/AdminBoards";
import AdminLive from "./components/Admin/AdminLive";
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
  if (isPending) return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[var(--surface-bg)] text-[var(--surface-muted)]">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <p className="text-sm">Connecting…</p>
    </div>
  );
  if (!session) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} />;
  }
  return children;
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
          <Route path="/verify" element={<VerifyEmail />} />
          <Route
            path="/whiteboards"
            element={<Protected><WhiteboardHome /></Protected>}
          />
          <Route
            path="/account"
            element={<Protected><AccountSettings /></Protected>}
          />
          {/* Whiteboard editor is publicly accessible — guests can join via link.
              Auth is enforced at the socket level based on shareAccess setting. */}
          <Route
            path="/whiteboard/:id"
            element={
              <Suspense fallback={<EditorFallback />}>
                <WhiteboardEditor />
              </Suspense>
            }
          />
          {/* Admin panel */}
          <Route
            path="/admin"
            element={<AdminRoute><AdminLayout /></AdminRoute>}
          >
            <Route index element={<Navigate to="/admin/stats" />} />
            <Route path="stats" element={<AdminStats />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="boards" element={<AdminBoards />} />
            <Route path="live" element={<AdminLive />} />
          </Route>
          <Route path="*" element={<Navigate to="/whiteboards" />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}
