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
  if (isPending) return null;
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
