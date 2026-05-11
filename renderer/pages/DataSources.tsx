import { useState, useEffect } from 'react';
import { useProjectStore, Project, DataSource, ProjectConfig } from '../stores/projectStore';

type TabType = 'projects' | 'datasource' | 'config';

function DataSources() {
  const {
    projects,
    activeProject,
    activeDataSource,
    activeConfig,
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
  } = useProjectStore();

  const [activeTab, setActiveTab] = useState<TabType>('projects');
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectForm, setProjectForm] = useState({
    name: '',
    description: '',
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

  useEffect(() => {
    loadProjects();
    loadActiveProjectDetails();
  }, [loadProjects, loadActiveProjectDetails]);

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

  const handleSelectProject = async (project: Project) => {
    await setActiveProject(project.id);
  };

  const resetProjectForm = () => {
    setProjectForm({ name: '', description: '' });
    setEditingProject(null);
  };

  const handleOpenProjectModal = (project?: Project) => {
    if (project) {
      setEditingProject(project);
      setProjectForm({ name: project.name, description: project.description || '' });
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

                  <div className="flex justify-end pt-4 border-t">
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
