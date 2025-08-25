import { useState, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      
      const data = await res.json();
      setResponse(data.response || 'No response received');
    } catch (error) {
      setResponse('Error: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <Head>
        <title>FixFlow - Maintenance Management</title>
        <meta name="description" content="FixFlow Maintenance Management System" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            🏢 FixFlow
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Maintenance Management System
          </p>
          <div className="flex justify-center space-x-4">
            <a 
              href="https://t.me/fixflowbot" 
              target="_blank" 
              rel="noopener noreferrer"
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              📱 Telegram Bot
            </a>
            <a 
              href="/dashboard" 
              className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              📊 Dashboard
            </a>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-8 mb-12">
          <div className="bg-white p-6 rounded-xl shadow-lg">
            <div className="text-3xl mb-4">🔧</div>
            <h3 className="text-xl font-semibold mb-2">Work Orders</h3>
            <p className="text-gray-600">Create and manage maintenance requests with ease</p>
          </div>
          
          <div className="bg-white p-6 rounded-xl shadow-lg">
            <div className="text-3xl mb-4">📊</div>
            <h3 className="text-xl font-semibold mb-2">Analytics</h3>
            <p className="text-gray-600">Track performance and completion rates</p>
          </div>
          
          <div className="bg-white p-6 rounded-xl shadow-lg">
            <div className="text-3xl mb-4">👥</div>
            <h3 className="text-xl font-semibold mb-2">Team Management</h3>
            <p className="text-gray-600">Assign tasks and manage team roles</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold mb-6 text-center">Quick Actions</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button className="bg-blue-500 hover:bg-blue-600 text-white p-4 rounded-lg font-semibold transition-colors">
              ➕ New Issue
            </button>
            <button className="bg-green-500 hover:bg-green-600 text-white p-4 rounded-lg font-semibold transition-colors">
              📋 My Issues
            </button>
            <button className="bg-purple-500 hover:bg-purple-600 text-white p-4 rounded-lg font-semibold transition-colors">
              📊 Statistics
            </button>
            <button className="bg-orange-500 hover:bg-orange-600 text-white p-4 rounded-lg font-semibold transition-colors">
              ⚙️ Settings
            </button>
          </div>
        </div>

        {/* Chat Interface */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold mb-6 text-center">💬 Chat with FixFlow</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here..."
                className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows="4"
              />
            </div>
            <div className="flex justify-center">
              <button
                type="submit"
                disabled={isLoading}
                className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
              >
                {isLoading ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </form>
          
          {response && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold mb-2">Response:</h3>
              <p className="text-gray-700">{response}</p>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 text-white py-8 mt-16">
        <div className="container mx-auto px-4 text-center">
          <p>&copy; 2024 FixFlow. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
