import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ApiDetailsPage } from './pages/ApiDetailsPage';
import { ApisPage } from './pages/ApisPage';
import { ChangesPage } from './pages/ChangesPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { NewApiPage } from './pages/NewApiPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { WorkersPage } from './pages/WorkersPage';

export function App() { return <Routes><Route element={<Layout />}><Route index element={<DashboardPage />} /><Route path="apis" element={<ApisPage />} /><Route path="apis/new" element={<NewApiPage />} /><Route path="apis/:id" element={<ApiDetailsPage />} /><Route path="apis/:id/changes" element={<ChangesPage />} /><Route path="jobs" element={<JobsPage />} /><Route path="workers" element={<WorkersPage />} /><Route path="*" element={<NotFoundPage />} /></Route></Routes>; }
