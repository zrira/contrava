const baseUrl = 'https://api.example.test';
export const loadTeam = (teamId: string) => apiClient.get(`${baseUrl}/teams/${teamId}`);
