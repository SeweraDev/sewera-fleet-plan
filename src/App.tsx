import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/providers/AuthProvider";
import { ProtectedRoute } from "@/components/shared/ProtectedRoute";
import { AppLayout } from "@/components/shared/AppLayout";
import LoginPage from "@/pages/LoginPage";
import UnauthorizedPage from "@/pages/UnauthorizedPage";
import AdminUzytkownicy from "@/pages/admin/Uzytkownicy";
import ZarzadDashboard from "@/pages/zarzad/Dashboard";
import DyspozytorDashboard from "@/pages/dyspozytor/Dashboard";
import SprzedawcaDashboard from "@/pages/sprzedawca/Dashboard";
import KierowcaMojaTrasa from "@/pages/kierowca/MojaTrasa";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/403" element={<UnauthorizedPage />} />

            {/* Admin */}
            <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
              <Route element={<AppLayout />}>
                <Route path="/admin" element={<AdminUzytkownicy />} />
              </Route>
            </Route>

            {/* Zarząd */}
            <Route element={<ProtectedRoute allowedRoles={['zarzad']} />}>
              <Route element={<AppLayout />}>
                <Route path="/zarzad" element={<ZarzadDashboard />} />
              </Route>
            </Route>

            {/* Dyspozytor */}
            <Route element={<ProtectedRoute allowedRoles={['dyspozytor']} />}>
              <Route element={<AppLayout />}>
                <Route path="/dyspozytor" element={<DyspozytorDashboard />} />
              </Route>
            </Route>

            {/* Sprzedawca */}
            <Route element={<ProtectedRoute allowedRoles={['sprzedawca']} />}>
              <Route element={<AppLayout />}>
                <Route path="/sprzedawca" element={<SprzedawcaDashboard />} />
              </Route>
            </Route>

            {/* Kierowca */}
            <Route element={<ProtectedRoute allowedRoles={['kierowca']} />}>
              <Route element={<AppLayout />}>
                <Route path="/kierowca" element={<KierowcaMojaTrasa />} />
              </Route>
            </Route>

            {/* Root redirect */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
