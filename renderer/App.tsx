import { useState } from 'react';
import DataSources from './pages/DataSources';
import Schema from './pages/Schema';

function App() {
  const [currentRoute, setCurrentRoute] = useState('schema');

  return (
    <div className="flex h-screen bg-gray-100">
      {/* 侧边栏和主内容现在由Schema组件管理 */}
      {currentRoute === 'schema' ? (
        <Schema />
      ) : (
        <div className="flex w-full">
          <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h1 className="text-2xl font-bold text-gray-900">zoehis-helper</h1>
            </div>
            
            <nav className="flex-1 p-4 space-y-2">
              <button
                onClick={() => setCurrentRoute('schema')}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                <span className="text-lg">📊</span>
                <span className="font-medium">数据查询</span>
              </button>
              
              <button
                onClick={() => setCurrentRoute('datasources')}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg bg-blue-50 text-blue-700 border border-blue-200"
              >
                <span className="text-lg">🔌</span>
                <span className="font-medium">数据源管理</span>
              </button>
            </nav>
          </div>
          
          <div className="flex-1 overflow-auto p-6">
            <DataSources />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
