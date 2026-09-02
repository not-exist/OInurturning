import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/app.css';
import { RequireAuth } from './app/guards';
import { Layout } from './app/App';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { StudentsPage } from './features/students/StudentsPage';
import { StudentDetailPage } from './features/students/StudentDetailPage';
import { AcademyPage } from './features/academy/AcademyPage';
import { InventoryPage } from './features/items/InventoryPage';
import { TrainingPage } from './features/training/TrainingPage';
import { StoryPage } from './features/story/StoryPage';
import { RecordReportPage } from './features/records/RecordReportPage';
import { AdventurePage } from './features/adventure/AdventurePage';
import { AcademyLecturePage } from './features/academy/AcademyLecturePage';
import { ProblemLibraryPage } from './features/problems/ProblemLibraryPage';

const qc = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route
                path="/"
                element={<p className="text-neutral-500">欢迎回来，教练。请从左侧选择功能。</p>}
              />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/students" element={<StudentsPage />} />
              <Route path="/students/:id" element={<StudentDetailPage />} />
              <Route path="/training" element={<TrainingPage />} />
              <Route path="/backpack" element={<InventoryPage />} />
              <Route path="/academy" element={<AcademyPage />} />
              <Route path="/academy/lecture" element={<AcademyLecturePage />} />
              <Route path="/problem-library" element={<ProblemLibraryPage />} />
              <Route path="/story" element={<StoryPage />} />
              <Route path="/adventure" element={<AdventurePage />} />
              <Route path="/records/:recordId" element={<RecordReportPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
