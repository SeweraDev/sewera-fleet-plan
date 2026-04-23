import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/shared/ProtectedRoute";
import LoginPage from "@/pages/LoginPage";
import UnauthorizedPage from "@/pages/UnauthorizedPage";
import AdminUzytkownicy from "@/pages/admin/Uzytkownicy";
import ZarzadDashboard from "@/pages/zarzad/Dashboard";
import DyspozytorDashboard from "@/pages/dyspozytor/Dashboard";
import SprzedawcaDashboard from "@/pages/sprzedawca/Dashboard";
import KierowcaMojaTrasa from "@/pages/kierowca/MojaTrasa";
import MapaSewera from "@/pages/MapaSewera";
import PrzegladOddzialow from "@/pages/PrzegladOddzialow";
import KartaDrogowa from "@/pages/KartaDrogowa";
import { RootRedirect } from "@/components/shared/RootRedirect";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/403" element={<UnauthorizedPage />} />

          {/* Admin */}
          <Route path="/admin" element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminUzytkownicy />
            </ProtectedRoute>
          } />

          {/* Zarząd */}
          <Route path="/zarzad" element={
            <ProtectedRoute allowedRoles={['zarzad', 'admin']}>
              <ZarzadDashboard />
            </ProtectedRoute>
          } />

          {/* Dyspozytor */}
          <Route path="/dyspozytor" element={
            <ProtectedRoute allowedRoles={['dyspozytor', 'admin']}>
              <DyspozytorDashboard />
            </ProtectedRoute>
          } />

          {/* Sprzedawca */}
          <Route path="/sprzedawca" element={
            <ProtectedRoute allowedRoles={['sprzedawca', 'admin']}>
              <SprzedawcaDashboard />
            </ProtectedRoute>
          } />

          {/* Kierowca */}
          <Route path="/kierowca" element={
            <ProtectedRoute allowedRoles={['kierowca']}>
              <KierowcaMojaTrasa />
            </ProtectedRoute>
          } />

          {/* Mapa — dostępna dla wszystkich zalogowanych */}
          <Route path="/mapa" element={
            <ProtectedRoute allowedRoles={['admin', 'zarzad', 'dyspozytor', 'sprzedawca', 'kierowca']}>
              <MapaSewera />
            </ProtectedRoute>
          } />

          {/* Podgląd oddziałów — te same role co Mapa dostaw */}
          <Route path="/przeglad-oddzialow" element={
            <ProtectedRoute allowedRoles={['admin', 'zarzad', 'dyspozytor', 'sprzedawca', 'kierowca']}>
              <PrzegladOddzialow />
            </ProtectedRoute>
          } />

          {/* Karta drogowa — widok do druku (dyspozytor + kierowca + zarząd) */}
          <Route path="/karta-drogowa/:kursId" element={
            <ProtectedRoute allowedRoles={['admin', 'zarzad', 'dyspozytor', 'kierowca']}>
              <KartaDrogowa />
            </ProtectedRoute>
          } />

          {/* Root redirect */}
          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
