import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Project {
  id: string;
  name: string;
  description?: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface DataSource {
  id: string;
  projectId: string;
  name: string;
  type: 'oracle' | 'dameng';
  host: string;
  port: number;
  sid?: string;
  serviceName?: string;
  schema?: string;
  username: string;
  password: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConfig {
  id: string;
  projectId: string;
  apiBaseUrl?: string;
  apiTokenPath?: string;
  apiVersionPath?: string;
  apiLogPath?: string;
  redisHost?: string;
  redisPort?: number;
  redisPassword?: string;
  redisDb?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodeRepository {
  id: string;
  projectId: string;
  name: string;
  repositoryUrl: string;
  servicePatterns: string;
  gitLabToken?: string;
  defaultBranch?: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectStore {
  projects: Project[];
  activeProject: Project | null;
  activeDataSource: DataSource | null;
  activeConfig: ProjectConfig | null;
  codeRepositories: CodeRepository[];
  isLoading: boolean;

  loadProjects: () => Promise<void>;
  loadActiveProjectDetails: () => Promise<void>;
  createProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Project>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setActiveProject: (id: string) => Promise<void>;

  loadProjectDataSource: (projectId: string) => Promise<void>;
  createOrUpdateDataSource: (ds: Omit<DataSource, 'id' | 'createdAt' | 'updatedAt' | 'password'> & { password: string }) => Promise<DataSource>;
  deleteDataSource: (id: string) => Promise<void>;

  loadProjectConfig: (projectId: string) => Promise<void>;
  saveProjectConfig: (config: Omit<ProjectConfig, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;

  testDataSourceConnection: (ds: Partial<DataSource>) => Promise<{ success: boolean; message: string }>;
  executeQuery: (sql: string) => Promise<any>;

  // Code repository methods
  loadCodeRepositories: (projectId: string) => Promise<void>;
  createCodeRepository: (repo: Omit<CodeRepository, 'id' | 'createdAt' | 'updatedAt'>) => Promise<CodeRepository>;
  updateCodeRepository: (id: string, updates: Partial<CodeRepository>) => Promise<void>;
  deleteCodeRepository: (id: string) => Promise<void>;
  createDefaultCodeRepositories: (projectId: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProject: null,
      activeDataSource: null,
      activeConfig: null,
      codeRepositories: [],
      isLoading: false,

      loadProjects: async () => {
        set({ isLoading: true });
        try {
          const projects = await window.electronAPI.project.getAll();
          set({ projects, isLoading: false });
        } catch (error) {
          console.error('Failed to load projects:', error);
          set({ isLoading: false });
        }
      },

      loadActiveProjectDetails: async () => {
        set({ isLoading: true });
        try {
          const details = await window.electronAPI.project.getActiveWithDetails();
          set({
            activeProject: details.project || null,
            activeDataSource: details.dataSource || null,
            activeConfig: details.config || null,
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to load active project details:', error);
          set({ isLoading: false });
        }
      },

      createProject: async (project) => {
        const newProject = await window.electronAPI.project.create(project);
        set((state) => ({ projects: [newProject, ...state.projects] }));
        return newProject;
      },

      updateProject: async (id, updates) => {
        const updated = await window.electronAPI.project.update(id, updates);
        if (updated) {
          set((state) => ({
            projects: state.projects.map((p) => (p.id === id ? updated : p)),
            activeProject: state.activeProject?.id === id ? updated : state.activeProject,
          }));
        }
      },

      deleteProject: async (id) => {
        await window.electronAPI.project.delete(id);
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          activeProject: state.activeProject?.id === id ? null : state.activeProject,
          activeDataSource: state.activeProject?.id === id ? null : state.activeDataSource,
          activeConfig: state.activeProject?.id === id ? null : state.activeConfig,
        }));
      },

      setActiveProject: async (id) => {
        await window.electronAPI.project.setActive(id);
        await get().loadActiveProjectDetails();
        await get().loadProjects();
      },

      loadProjectDataSource: async (projectId) => {
        try {
          const dataSource = await (window.electronAPI as any).project.getDataSource(projectId);
          set({ activeDataSource: dataSource || null });
        } catch (error) {
          console.error('Failed to load project data source:', error);
        }
      },

      createOrUpdateDataSource: async (ds) => {
        // 先检查该项目是否已有数据源
        const existingDataSource = await (window.electronAPI as any).project.getDataSource(ds.projectId);
        let saved;
        
        if (existingDataSource) {
          // 已有数据源，执行更新
          saved = await (window.electronAPI as any).project.updateDataSource(existingDataSource.id, ds);
        } else {
          // 没有数据源，执行创建
          saved = await (window.electronAPI as any).project.createDataSource(ds);
        }
        
        set({ activeDataSource: saved });
        return saved;
      },

      deleteDataSource: async (id) => {
        await window.electronAPI.project.deleteDataSource(id);
        set({ activeDataSource: null });
      },

      loadProjectConfig: async (projectId) => {
        try {
          const config = await window.electronAPI.project.getConfig(projectId);
          set({ activeConfig: config || null });
        } catch (error) {
          console.error('Failed to load project config:', error);
        }
      },

      saveProjectConfig: async (config) => {
        const saved = await window.electronAPI.project.saveConfig(config);
        set({ activeConfig: saved });
      },

      testDataSourceConnection: async (ds) => {
        return await window.electronAPI.project.testDataSourceConnection(ds);
      },

      executeQuery: async (sql) => {
        if (!get().activeDataSource?.id) {
          throw new Error('没有选中的数据源');
        }
        return await window.electronAPI.project.executeQuery(get().activeDataSource!.id, sql);
      },

      // Code repository methods
      loadCodeRepositories: async (projectId) => {
        try {
          const repos = await (window.electronAPI as any).getCodeRepositories(projectId);
          set({ codeRepositories: repos });
        } catch (error) {
          console.error('Failed to load code repositories:', error);
        }
      },

      createCodeRepository: async (repo) => {
        const newRepo = await (window.electronAPI as any).createCodeRepository(repo);
        set((state) => ({ codeRepositories: [...state.codeRepositories, newRepo] }));
        return newRepo;
      },

      updateCodeRepository: async (id, updates) => {
        const updated = await (window.electronAPI as any).updateCodeRepository(id, updates);
        if (updated) {
          set((state) => ({
            codeRepositories: state.codeRepositories.map((r) => (r.id === id ? updated : r)),
          }));
        }
      },

      deleteCodeRepository: async (id) => {
        await (window.electronAPI as any).deleteCodeRepository(id);
        set((state) => ({
          codeRepositories: state.codeRepositories.filter((r) => r.id !== id),
        }));
      },

      createDefaultCodeRepositories: async (projectId) => {
        await (window.electronAPI as any).createDefaultCodeRepositories(projectId);
        await get().loadCodeRepositories(projectId);
      },
    }),
    {
      name: 'zoe-devops-project-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeProject: state.activeProject,
      }),
    }
  )
);
