import { useState, useEffect } from 'react';
import { useProjectStore, Project, ProjectConfig, CodeRepository } from '../stores/projectStore';

type TabType = 'projects' | 'datasource' | 'config' | 'code-repos' | 'ai-config';

function DataSources() {
  const {
    projects,
    activeProject,
    activeDataSource,
    activeConfig,
    codeRepositories,
    loadProjects,
    loadActiveProjectDetails,
    createProject,
    updateProject,
    deleteProject,
    setActiveProject,
    createOrUpdateDataSource,
    deleteDataSource,
    loadProjectConfig,
    saveProjectConfig,
    testDataSourceConnection,
    loadCodeRepositories,
    createCodeRepository,
    updateCodeRepository,
    deleteCodeRepository,
    createDefaultCodeRepositories,
  } = useProjectStore();

  const [activeTab, setActiveTab] = useState<TabType>('projects');
  const [aiConfigForm, setAiConfigForm] = useState({
    deepseekApiKey: '',
    deepseekBaseUrl: 'https://api.deepseek.com/v1',
    deepseekModel: 'deepseek-chat',
    gitLabBaseUrl: 'http://gitlab.zoesoft.com.cn',
    gitLabToken: '',
  });
  const [aiConfigSaving, setAiConfigSaving] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectForm, setProjectForm] = useState({
    name: '',
    description: '',
    isActive: 0,
  });

  const [dsModalOpen, setDsModalOpen] = useState(false);
  const [dsForm, setDsForm] = useState({
    name: '',
    type: 'oracle' as 'oracle' | 'dameng',
    host: 'localhost',
    port: 1521,
    sid: '',
    serviceName: '',
    schema: '',
    username: '',
    password: '',
  });

  const [configForm, setConfigForm] = useState<Omit<ProjectConfig, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>({
    apiBaseUrl: '',
    apiTokenPath: '',
    apiVersionPath: '',
    apiLogPath: '',
    redisHost: '',
    redisPort: 6379,
    redisPassword: '',
    redisDb: 0,
  });

  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testRedisLoading, setTestRedisLoading] = useState(false);
  const [redisTokenResult, setRedisTokenResult] = useState<{ success: boolean; message: string; token?: string } | null>(null);

  // Code repository management
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<CodeRepository | null>(null);
  const [repoForm, setRepoForm] = useState({
    name: '',
    repositoryUrl: '',
    servicePatterns: '',
  });
  const [repoSaving, setRepoSaving] = useState(false);

  useEffect(() => {
    loadProjects();
    loadActiveProjectDetails();
  }, [loadProjects, loadActiveProjectDetails]);

  // Load code repositories when project changes or tab is active
  useEffect(() => {
    if (activeProject && activeTab === 'code-repos') {
      loadCodeRepositories(activeProject.id);
    }
  }, [activeProject, activeTab, loadCodeRepositories]);

  useEffect(() => {
    if (activeProject && activeTab === 'datasource') {
      setDsForm({
        name: activeDataSource?.name || '',
        type: activeDataSource?.type || 'oracle',
        host: activeDataSource?.host || 'localhost',
        port: activeDataSource?.port || 1521,
        sid: activeDataSource?.sid || '',
        serviceName: activeDataSource?.serviceName || '',
        schema: activeDataSource?.schema || '',
        username: activeDataSource?.username || '',
        password: activeDataSource?.password || '',
      });
    }
  }, [activeProject, activeTab, activeDataSource]);

  useEffect(() => {
    if (activeProject && activeTab === 'config') {
      loadProjectConfig(activeProject.id);
    }
  }, [activeProject, activeTab, loadProjectConfig]);

  useEffect(() => {
    if (activeConfig) {
      setConfigForm({
        apiBaseUrl: activeConfig.apiBaseUrl || '',
        apiTokenPath: activeConfig.apiTokenPath || '',
        apiVersionPath: activeConfig.apiVersionPath || '',
        apiLogPath: activeConfig.apiLogPath || '',
        redisHost: activeConfig.redisHost || '',
        redisPort: activeConfig.redisPort || 6379,
        redisPassword: activeConfig.redisPassword || '',
        redisDb: activeConfig.redisDb || 0,
      });
    }
  }, [activeConfig]);

  // Load global config when component mounts
  useEffect(() => {
    const loadGlobalConfig = async () => {
      try {
        const config = await (window.electronAPI as any).getGlobalConfig();
        if (config) {
          setAiConfigForm({
            deepseekApiKey: config.deepseekApiKey || '',
            deepseekBaseUrl: config.deepseekBaseUrl || 'https://api.deepseek.com/v1',
            deepseekModel: config.deepseekModel || 'deepseek-chat',
            gitLabBaseUrl: config.gitLabBaseUrl || 'http://gitlab.zoesoft.com.cn',
            gitLabToken: config.gitLabToken || '',
          });
        }
      } catch (error) {
        console.error('Failed to load global config:', error);
      }
    };
    loadGlobalConfig();
  }, []);

  const handleSaveAIConfig = async () => {
    setAiConfigSaving(true);
    try {
      await (window.electronAPI as any).saveGlobalConfig(aiConfigForm);
      alert('AI configuration saved successfully!');
    } catch (error) {
      console.error('Failed to save AI config:', error);
      alert('Failed to save AI configuration');
    } finally {
      setAiConfigSaving(false);
    }
  };

  const handleSelectProject = async (project: Project) => {
    await setActiveProject(project.id);
  };

  const resetProjectForm = () => {
    setProjectForm({ name: '', description: '', isActive: 0 });
    setEditingProject(null);
  };

  const handleOpenProjectModal = (project?: Project) => {
    if (project) {
      setEditingProject(project);
      setProjectForm({ name: project.name, description: project.description || '', isActive: project.isActive });
    } else {
      resetProjectForm();
    }
    setProjectModalOpen(true);
  };

  const handleSaveProject = async () => {
    setSaving(true);
    try {
      if (editingProject) {
        await updateProject(editingProject.id, projectForm);
      } else {
        await createProject(projectForm);
      }
      setProjectModalOpen(false);
      resetProjectForm();
    } catch (error) {
      console.error('Failed to save project:', error);
    }
    setSaving(false);
  };

  const handleDeleteProject = async (id: string) => {
    if (confirm('确定要删除这个项目吗？')) {
      try {
        await deleteProject(id);
      } catch (error) {
        console.error('Failed to delete project:', error);
      }
    }
  };

  const handleOpenDsModal = () => {
    setDsModalOpen(true);
  };

  const handleTestDsConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testDataSourceConnection(dsForm);
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, message: (error as Error).message });
    }
    setIsTesting(false);
  };

  const handleSaveDs = async () => {
    if (!activeProject) return;
    setSaving(true);
    try {
      await createOrUpdateDataSource({
        projectId: activeProject.id,
        ...dsForm,
      });
      // 重新加载项目详情，确保最新的数据源信息同步到 store
      await loadActiveProjectDetails();
      setDsModalOpen(false);
      setTestResult(null);
    } catch (error) {
      console.error('Failed to save data source:', error);
    }
    setSaving(false);
  };

  const handleDeleteDs = async () => {
    if (!activeDataSource) return;
    if (confirm('确定要删除这个数据源吗？')) {
      try {
        await deleteDataSource(activeDataSource.id);
        // 重新加载项目详情，确保 store 更新
        await loadActiveProjectDetails();
      } catch (error) {
        console.error('Failed to delete data source:', error);
      }
    }
  };

  const handleSaveConfig = async () => {
    if (!activeProject) return;
    setSaving(true);
    try {
      await saveProjectConfig({ projectId: activeProject.id, ...configForm });
      alert('配置保存成功');
    } catch (error) {
      console.error('Failed to save config:', error);
    }
    setSaving(false);
  };

  const handleTestRedisToken = async () => {
    if (!configForm.redisHost || !configForm.redisPort) {
      alert('请先填写 Redis Host 和 Port');
      return;
    }
    
    setTestRedisLoading(true);
    setRedisTokenResult(null);
    
    try {
      const result = await (window.electronAPI as any).getRedisFirstToken({
        host: configForm.redisHost,
        port: configForm.redisPort,
        password: configForm.redisPassword || undefined,
        db: configForm.redisDb || undefined,
      }, 'ONELINK:TOKEN:');
      
      if (result.success && result.token) {
        setRedisTokenResult({
          success: true,
          message: '获取 Token 成功！',
          token: result.token,
        });
      } else {
        setRedisTokenResult({
          success: false,
          message: result.message || '未找到 Token',
        });
      }
    } catch (error) {
      setRedisTokenResult({
        success: false,
        message: (error as Error).message,
      });
    }
    
    setTestRedisLoading(false);
  };

  // Code repository handlers
  const resetRepoForm = () => {
    setRepoForm({
      name: '',
      repositoryUrl: '',
      servicePatterns: '',
    });
    setEditingRepo(null);
  };

  const handleOpenRepoModal = (repo?: CodeRepository) => {
    if (repo) {
      setEditingRepo(repo);
      setRepoForm({
        name: repo.name,
        repositoryUrl: repo.repositoryUrl,
        servicePatterns: repo.servicePatterns,
      });
    } else {
      resetRepoForm();
    }
    setRepoModalOpen(true);
  };

  const handleSaveRepo = async () => {
    if (!activeProject) return;
    if (!repoForm.name.trim() || !repoForm.repositoryUrl.trim()) {
      alert('请填写仓库名称和地址');
      return;
    }

    setRepoSaving(true);
    try {
      if (editingRepo) {
        await updateCodeRepository(editingRepo.id, repoForm);
      } else {
        await createCodeRepository({
          projectId: activeProject.id,
          ...repoForm,
        });
      }
      setRepoModalOpen(false);
      resetRepoForm();
    } catch (error) {
      console.error('Failed to save repository:', error);
      alert('保存失败: ' + (error as Error).message);
    }
    setRepoSaving(false);
  };

  const handleDeleteRepo = async (id: string) => {
    if (confirm('确定要删除这个代码仓库吗？')) {
      try {
        await deleteCodeRepository(id);
      } catch (error) {
        console.error('Failed to delete repository:', error);
        alert('删除失败');
      }
    }
  };

  const handleLoadDefaultRepos = async () => {
    if (!activeProject) return;
    if (confirm('这将初始化默认的代码仓库配置（医嘱后端、收费后端等），继续吗？')) {
      try {
        await createDefaultCodeRepositories(activeProject.id);
        alert('默认仓库配置已加载！');
      } catch (error) {
        console.error('Failed to load default repos:', error);
        alert('加载默认配置失败');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">项目管理</h2>
        {activeTab === 'projects' && (
          <button
            onClick={() => handleOpenProjectModal()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
          >
            新建项目
          </button>
        )}
        {activeTab === 'datasource' && activeProject && !activeDataSource && (
          <button
            onClick={() => handleOpenDsModal()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
          >
            配置数据源
          </button>
        )}
      </div>

      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => setActiveTab('projects')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'projects' ? 'bg-white text-blue-600 shadow' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          项目
        </button>
        <button
          onClick={() => setActiveTab('datasource')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'datasource' ? 'bg-white text-blue-600 shadow' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          数据源
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'config' ? 'bg-white text-blue-600 shadow' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          API & Redis
        </button>
        <button
          onClick={() => setActiveTab('code-repos')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'code-repos' ? 'bg-white text-blue-600 shadow' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          代码仓库
        </button>
        <button
          onClick={() => setActiveTab('ai-config')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'ai-config' ? 'bg-white text-blue-600 shadow' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          全局配置
        </button>
      </div>

      {activeTab === 'projects' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  项目名称
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  描述
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {projects.map((project) => (
                <tr key={project.id} className={`hover:bg-gray-50 ${project.id === activeProject?.id ? 'bg-blue-50' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="font-medium text-gray-900">{project.name}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-500">{project.description || '-'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {project.id === activeProject?.id ? (
                      <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">当前项目</span>
                    ) : (
                      <button
                        onClick={() => handleSelectProject(project)}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        设为当前
                      </button>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm space-x-4">
                    <button
                      onClick={() => handleOpenProjectModal(project)}
                      className="text-gray-600 hover:text-gray-800 font-medium"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDeleteProject(project.id)}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                    暂无项目，点击"新建项目"创建
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'datasource' && (
        <div>
          {!activeProject ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center text-yellow-800">
              请先选择一个项目
            </div>
          ) : (
            <>
              <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">当前项目：</span>
                  <span className="font-semibold text-blue-700">{activeProject.name}</span>
                </div>
              </div>
              
              {activeDataSource ? (
                <div className="bg-white rounded-lg shadow p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold">数据源配置</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDsModalOpen(true)}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                      >
                        编辑
                      </button>
                      <button
                        onClick={handleDeleteDs}
                        className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-500">数据源名称</label>
                      <div className="mt-1 text-gray-900">{activeDataSource.name}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500">数据库类型</label>
                      <div className="mt-1">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          activeDataSource.type === 'oracle' ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {activeDataSource.type === 'oracle' ? 'Oracle' : '达梦'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500">主机地址</label>
                      <div className="mt-1 text-gray-900">{activeDataSource.host}:{activeDataSource.port}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-500">用户名</label>
                      <div className="mt-1 text-gray-900">{activeDataSource.username}</div>
                    </div>
                    {activeDataSource.type === 'oracle' ? (
                      <>
                        {activeDataSource.sid && (
                          <div>
                            <label className="block text-sm font-medium text-gray-500">SID</label>
                            <div className="mt-1 text-gray-900">{activeDataSource.sid}</div>
                          </div>
                        )}
                        {activeDataSource.serviceName && (
                          <div>
                            <label className="block text-sm font-medium text-gray-500">Service Name</label>
                            <div className="mt-1 text-gray-900">{activeDataSource.serviceName}</div>
                          </div>
                        )}
                      </>
                    ) : (
                      activeDataSource.schema && (
                        <div>
                          <label className="block text-sm font-medium text-gray-500">数据库名称</label>
                          <div className="mt-1 text-gray-900">{activeDataSource.schema}</div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow p-12 text-center">
                  <div className="text-gray-500 mb-4">暂无数据源配置</div>
                  <button
                    onClick={() => handleOpenDsModal()}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                  >
                    配置数据源
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'config' && (
        <div>
          {!activeProject ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center text-yellow-800">
              请先选择一个项目
            </div>
          ) : (
            <>
              <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">当前项目：</span>
                  <span className="font-semibold text-blue-700">{activeProject.name}</span>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-6">API & Redis 配置</h3>
                
                <div className="space-y-8">
                  <div className="border-b pb-6">
                    <h4 className="text-md font-medium text-gray-800 mb-4">API 配置</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                        <input
                          type="text"
                          value={configForm.apiBaseUrl}
                          onChange={(e) => setConfigForm({ ...configForm, apiBaseUrl: e.target.value })}
                          placeholder="http://api.example.com"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Token Path</label>
                        <input
                          type="text"
                          value={configForm.apiTokenPath}
                          onChange={(e) => setConfigForm({ ...configForm, apiTokenPath: e.target.value })}
                          placeholder="/api/auth/token"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Version Path</label>
                        <input
                          type="text"
                          value={configForm.apiVersionPath}
                          onChange={(e) => setConfigForm({ ...configForm, apiVersionPath: e.target.value })}
                          placeholder="/api/system/version"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Log Path</label>
                        <input
                          type="text"
                          value={configForm.apiLogPath}
                          onChange={(e) => setConfigForm({ ...configForm, apiLogPath: e.target.value })}
                          placeholder="/api/logs"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-md font-medium text-gray-800 mb-4">Redis 配置</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Redis Host</label>
                        <input
                          type="text"
                          value={configForm.redisHost}
                          onChange={(e) => setConfigForm({ ...configForm, redisHost: e.target.value })}
                          placeholder="localhost"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Redis Port</label>
                        <input
                          type="number"
                          value={configForm.redisPort}
                          onChange={(e) => setConfigForm({ ...configForm, redisPort: parseInt(e.target.value) || 6379 })}
                          placeholder="6379"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <input
                          type="password"
                          value={configForm.redisPassword}
                          onChange={(e) => setConfigForm({ ...configForm, redisPassword: e.target.value })}
                          placeholder="密码"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">DB</label>
                        <input
                          type="number"
                          value={configForm.redisDb}
                          onChange={(e) => setConfigForm({ ...configForm, redisDb: parseInt(e.target.value) || 0 })}
                          placeholder="0"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                  </div>

                  {redisTokenResult && (
                    <div className={`mb-4 p-4 rounded-lg ${redisTokenResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                      <div className={`font-medium ${redisTokenResult.success ? 'text-green-800' : 'text-red-800'}`}>
                        {redisTokenResult.message}
                      </div>
                      {redisTokenResult.token && (
                        <div className="mt-2">
                          <div className="text-sm text-gray-600 mb-1">Token 值：</div>
                          <code className="block text-sm font-mono bg-white p-2 rounded break-all max-h-32 overflow-auto">
                            {redisTokenResult.token}
                          </code>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex justify-end gap-3 pt-4 border-t">
                    <button
                      onClick={handleTestRedisToken}
                      disabled={testRedisLoading}
                      className="px-6 py-2 border border-green-300 text-green-600 rounded-lg hover:bg-green-50 disabled:opacity-50 transition-colors"
                    >
                      {testRedisLoading ? '获取中...' : '测试获取 Token'}
                    </button>
                    <button
                      onClick={handleSaveConfig}
                      disabled={saving}
                      className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                    >
                      {saving ? '保存中...' : '保存配置'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'code-repos' && (
        <div>
          {!activeProject ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center text-yellow-800">
              请先选择一个项目
            </div>
          ) : (
            <>
              <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">当前项目：</span>
                    <span className="font-semibold text-blue-700">{activeProject.name}</span>
                  </div>
                  {codeRepositories.length === 0 && (
                    <button
                      onClick={handleLoadDefaultRepos}
                      className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium text-sm"
                    >
                      加载默认配置
                    </button>
                  )}
                </div>
              </div>
              
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">代码仓库配置</h3>
                <button
                  onClick={() => handleOpenRepoModal()}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                >
                  添加仓库
                </button>
              </div>

              {codeRepositories.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {codeRepositories.map((repo) => (
                    <div key={repo.id} className="bg-white rounded-lg shadow p-4 border border-gray-200">
                      <div className="flex justify-between items-start mb-3">
                        <h4 className="font-semibold text-gray-900">{repo.name}</h4>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleOpenRepoModal(repo)}
                            className="text-sm px-2 py-1 text-blue-600 hover:text-blue-800 font-medium"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDeleteRepo(repo.id)}
                            className="text-sm px-2 py-1 text-red-600 hover:text-red-800 font-medium"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-gray-500">仓库地址：</span>
                          <span className="text-gray-900 font-mono break-all">{repo.repositoryUrl}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">匹配模式：</span>
                          <span className="text-gray-900">{repo.servicePatterns}</span>
                        </div>
                        {repo.defaultBranch && (
                          <div>
                            <span className="text-gray-500">默认分支：</span>
                            <span className="text-gray-900">{repo.defaultBranch}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow p-12 text-center">
                  <div className="text-gray-500 mb-4">暂无代码仓库配置</div>
                  <div className="mb-4">
                    <button
                      onClick={handleLoadDefaultRepos}
                      className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
                    >
                      加载默认配置
                    </button>
                  </div>
                  <div className="text-sm text-gray-400">
                    默认配置包括：医嘱后端、收费后端、公共后端等
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'ai-config' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-6">全局配置</h3>
          
          <div className="space-y-8">
            {/* DeepSeek 配置区域 */}
            <div>
              <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
                DeepSeek
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                  <input
                    type="password"
                    value={aiConfigForm.deepseekApiKey}
                    onChange={(e) => setAiConfigForm({ ...aiConfigForm, deepseekApiKey: e.target.value })}
                    placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                  <input
                    type="text"
                    value={aiConfigForm.deepseekBaseUrl}
                    onChange={(e) => setAiConfigForm({ ...aiConfigForm, deepseekBaseUrl: e.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                  <input
                    type="text"
                    value={aiConfigForm.deepseekModel}
                    onChange={(e) => setAiConfigForm({ ...aiConfigForm, deepseekModel: e.target.value })}
                    placeholder="deepseek-chat / deepseek-coder"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* GitLab 配置区域 */}
            <div>
              <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
                GitLab
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                  <input
                    type="text"
                    value={aiConfigForm.gitLabBaseUrl}
                    onChange={(e) => setAiConfigForm({ ...aiConfigForm, gitLabBaseUrl: e.target.value })}
                    placeholder="http://gitlab.zoesoft.com.cn"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Token（全局回退）</label>
                  <input
                    type="password"
                    value={aiConfigForm.gitLabToken}
                    onChange={(e) => setAiConfigForm({ ...aiConfigForm, gitLabToken: e.target.value })}
                    placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="mt-1 text-xs text-gray-400">仓库级 Token 优先，此处作全局回退</p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">提示：</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>所有密钥均加密存储在本地，不会上传</li>
                  <li>DeepSeek API Key 请确保有足够余额</li>
                  <li>GitLab Token 可在用户设置 → Access Tokens 中生成</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSaveAIConfig}
                disabled={aiConfigSaving}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {aiConfigSaving ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {repoModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <h3 className="text-xl font-semibold mb-6">
              {editingRepo ? '编辑代码仓库' : '添加代码仓库'}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">仓库名称 *</label>
                <input
                  type="text"
                  required
                  value={repoForm.name}
                  onChange={(e) => setRepoForm({ ...repoForm, name: e.target.value })}
                  placeholder="例如：医嘱后端"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">仓库地址 *</label>
                <input
                  type="text"
                  required
                  value={repoForm.repositoryUrl}
                  onChange={(e) => setRepoForm({ ...repoForm, repositoryUrl: e.target.value })}
                  placeholder="http://gitlab.zoesoft.com.cn/onelink/..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  服务匹配模式 *
                  <span className="text-gray-500 font-normal ml-1">（逗号分隔，用于匹配日志中的服务名/URL）</span>
                </label>
                <input
                  type="text"
                  required
                  value={repoForm.servicePatterns}
                  onChange={(e) => setRepoForm({ ...repoForm, servicePatterns: e.target.value })}
                  placeholder="pres-service,prescription"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  当日志中的服务名或URL包含任一关键词时，会匹配到此仓库
                </p>
              </div>

              <div className="flex justify-end space-x-4 pt-4 border-t">
                <button
                  onClick={() => { setRepoModalOpen(false); resetRepoForm(); }}
                  className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveRepo}
                  disabled={repoSaving}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {repoSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {projectModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-semibold mb-6">
              {editingProject ? '编辑项目' : '新建项目'}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">项目名称 *</label>
                <input
                  type="text"
                  required
                  value={projectForm.name}
                  onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={projectForm.description}
                  onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex justify-end space-x-4 pt-4">
                <button
                  onClick={() => { setProjectModalOpen(false); resetProjectForm(); }}
                  className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveProject}
                  disabled={saving || !projectForm.name.trim()}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {dsModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-6">数据源配置</h3>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">数据源名称 *</label>
                <input
                  type="text"
                  required
                  value={dsForm.name}
                  onChange={(e) => setDsForm({ ...dsForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">数据库类型</label>
                  <select
                    value={dsForm.type}
                    onChange={(e) => setDsForm({ ...dsForm, type: e.target.value as 'oracle' | 'dameng' })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="oracle">Oracle</option>
                    <option value="dameng">达梦</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">主机地址</label>
                  <input
                    type="text"
                    value={dsForm.host}
                    onChange={(e) => setDsForm({ ...dsForm, host: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">端口</label>
                  <input
                    type="number"
                    value={dsForm.port}
                    onChange={(e) => setDsForm({ ...dsForm, port: parseInt(e.target.value) || 1521 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                
                {dsForm.type === 'oracle' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">SID</label>
                      <input
                        type="text"
                        value={dsForm.sid}
                        onChange={(e) => setDsForm({ ...dsForm, sid: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Service Name</label>
                      <input
                        type="text"
                        value={dsForm.serviceName}
                        onChange={(e) => setDsForm({ ...dsForm, serviceName: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">数据库名称</label>
                    <input
                      type="text"
                      value={dsForm.schema}
                      onChange={(e) => setDsForm({ ...dsForm, schema: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
                  <input
                    type="text"
                    value={dsForm.username}
                    onChange={(e) => setDsForm({ ...dsForm, username: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
                  <input
                    type="password"
                    value={dsForm.password}
                    onChange={(e) => setDsForm({ ...dsForm, password: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleTestDsConnection}
                  disabled={isTesting}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {isTesting ? '测试中...' : '测试连接'}
                </button>
                {testResult && (
                  <span className={testResult.success ? 'text-green-600' : 'text-red-600'}>
                    {testResult.message}
                  </span>
                )}
              </div>

              <div className="flex justify-end space-x-4 pt-4 border-t">
                <button
                  onClick={() => { setDsModalOpen(false); setTestResult(null); }}
                  className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveDs}
                  disabled={saving || !dsForm.name.trim() || !dsForm.username.trim()}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataSources;
