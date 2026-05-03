import { useState, useEffect } from 'react';
import { useDataSourceStore, DataSource } from '../stores/dataSourceStore';

function DataSources() {
  const { dataSources, createDataSource, updateDataSource, deleteDataSource, testConnection, setActiveDataSource, loadDataSources } = useDataSourceStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Omit<DataSource, 'id'>>({
    name: '',
    type: 'oracle',
    host: 'localhost',
    port: 1521,
    sid: '',
    serviceName: '',
    schema: '',
    username: '',
    password: '',
  });
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    loadDataSources();
  }, [loadDataSources]);

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'oracle',
      host: 'localhost',
      port: 1521,
      sid: '',
      serviceName: '',
      schema: '',
      username: '',
      password: '',
    });
    setEditingId(null);
    setTestResult(null);
  };

  const handleOpenModal = (ds?: DataSource) => {
    if (ds) {
      setEditingId(ds.id || null);
      setFormData({
        name: ds.name,
        type: ds.type,
        host: ds.host,
        port: ds.port,
        sid: ds.sid || '',
        serviceName: ds.serviceName || '',
        schema: ds.schema || '',
        username: ds.username,
        password: ds.password,
      });
    } else {
      resetForm();
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(formData);
      setTestResult(result);
    } catch (error) {
      setTestResult({ success: false, message: (error as Error).message });
    }
    setIsTesting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateDataSource(editingId, formData);
      } else {
        await createDataSource(formData);
      }
      handleCloseModal();
    } catch (error) {
      console.error('Failed to save data source:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定要删除这个数据源吗？')) {
      try {
        await deleteDataSource(id);
      } catch (error) {
        console.error('Failed to delete data source:', error);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">数据源管理</h2>
        <button
          onClick={() => handleOpenModal()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          添加数据源
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">名称</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">主机</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Schema</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {dataSources.map((ds) => (
              <tr key={ds.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="font-medium">{ds.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs rounded ${ds.type === 'oracle' ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                    {ds.type === 'oracle' ? 'Oracle' : '达梦'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {ds.host}:{ds.port}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">{ds.schema || ds.username}</td>
                <td className="px-6 py-4 whitespace-nowrap space-x-2">
                  <button
                    onClick={() => ds.id && setActiveDataSource(ds.id)}
                    className={`text-blue-600 hover:text-blue-800 text-sm ${ds.isActive ? 'font-bold' : ''}`}
                  >
                    {ds.isActive ? '当前' : '设为当前'}
                  </button>
                  <button
                    onClick={() => handleOpenModal(ds)}
                    className="text-gray-600 hover:text-gray-800 text-sm"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => ds.id && handleDelete(ds.id)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {dataSources.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  暂无数据源，点击"添加数据源"创建
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-4">
              {editingId ? '编辑数据源' : '添加数据源'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">名称</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">数据库类型</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as 'oracle' | 'dameng' })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="oracle">Oracle</option>
                  <option value="dameng">达梦</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">主机</label>
                  <input
                    type="text"
                    required
                    value={formData.host}
                    onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">端口</label>
                  <input
                    type="number"
                    required
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>

              {formData.type === 'oracle' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">SID</label>
                    <input
                      type="text"
                      value={formData.sid}
                      onChange={(e) => setFormData({ ...formData, sid: e.target.value })}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Service Name</label>
                    <input
                      type="text"
                      value={formData.serviceName}
                      onChange={(e) => setFormData({ ...formData, serviceName: e.target.value })}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700">数据库名称</label>
                  <input
                    type="text"
                    required
                    value={formData.schema}
                    onChange={(e) => setFormData({ ...formData, schema: e.target.value })}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700">Schema（可选）</label>
                <input
                  type="text"
                  value={formData.schema}
                  onChange={(e) => setFormData({ ...formData, schema: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="留空则使用用户名"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">用户名</label>
                <input
                  type="text"
                  required
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">密码</label>
                <input
                  type="password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>

              <div className="flex items-center space-x-4">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {isTesting ? '测试中...' : '测试连接'}
                </button>

                {testResult && (
                  <span className={testResult.success ? 'text-green-600' : 'text-red-600'}>
                    {testResult.message}
                  </span>
                )}
              </div>

              <div className="flex justify-end space-x-4 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataSources;
