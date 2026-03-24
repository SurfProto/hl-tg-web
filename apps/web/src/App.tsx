import { usePrivy } from '@privy-io/react-auth';

function App() {
  const { login, authenticated, user, logout } = usePrivy();

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <h1 className="text-2xl font-bold">Hyperliquid</h1>
            <nav className="hidden md:flex space-x-6">
              <a href="#" className="text-indigo-500 font-medium">Trade</a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors">Portfolio</a>
              <a href="#" className="text-gray-400 hover:text-white transition-colors">Rewards</a>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            {authenticated ? (
              <>
                <span className="text-sm text-gray-400">
                  {user?.wallet?.address?.slice(0, 6)}...{user?.wallet?.address?.slice(-4)}
                </span>
                <button
                  onClick={logout}
                  className="px-4 py-2 text-sm bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={login}
                className="px-4 py-2 text-sm bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {authenticated ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart Area */}
            <div className="lg:col-span-2 bg-gray-900 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">BTC-USD</h2>
              <div className="aspect-video bg-gray-800 rounded-lg flex items-center justify-center">
                <p className="text-gray-500">Chart will appear here</p>
              </div>
            </div>

            {/* Order Form */}
            <div className="bg-gray-900 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Place Order</h2>
              <div className="space-y-4">
                <div className="flex space-x-2">
                  <button className="flex-1 py-2 bg-indigo-600 rounded-lg font-medium">Buy</button>
                  <button className="flex-1 py-2 bg-gray-800 rounded-lg font-medium">Sell</button>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Order Type</label>
                  <select className="w-full bg-gray-800 rounded-lg px-3 py-2">
                    <option>Market</option>
                    <option>Limit</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Size (USD)</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="w-full bg-gray-800 rounded-lg px-3 py-2"
                  />
                </div>
                <button className="w-full py-3 bg-green-600 rounded-lg font-semibold hover:bg-green-500 transition-colors">
                  Buy BTC
                </button>
              </div>
            </div>

            {/* Orderbook */}
            <div className="bg-gray-900 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Orderbook</h2>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-red-500">67,500.00</span>
                  <span>0.5</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-red-500">67,499.00</span>
                  <span>1.2</span>
                </div>
                <div className="flex justify-between text-sm border-y border-gray-800 py-2">
                  <span className="text-white font-medium">67,498.50</span>
                  <span className="text-gray-500">Spread</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-green-500">67,498.00</span>
                  <span>0.8</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-green-500">67,497.00</span>
                  <span>1.5</span>
                </div>
              </div>
            </div>

            {/* Positions */}
            <div className="bg-gray-900 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Positions</h2>
              <p className="text-gray-500 text-sm">No open positions</p>
            </div>

            {/* Portfolio Summary */}
            <div className="bg-gray-900 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Portfolio</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400">Account Value</span>
                  <span className="font-medium">$0.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Available Margin</span>
                  <span className="font-medium">$0.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Total PnL</span>
                  <span className="font-medium text-green-500">$0.00</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
            <div className="text-center">
              <h2 className="text-4xl font-bold mb-4">Welcome to Hyperliquid</h2>
              <p className="text-gray-400 text-lg max-w-md">
                Trade perpetual contracts with up to 50x leverage. Connect your wallet to get started.
              </p>
            </div>
            <button
              onClick={login}
              className="px-8 py-4 bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors font-semibold text-lg"
            >
              Connect Wallet
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <p className="text-gray-500 text-sm">
              © 2024 Hyperliquid Trading. All rights reserved.
            </p>
            <div className="flex space-x-6">
              <a href="#" className="text-gray-500 hover:text-white text-sm transition-colors">Terms</a>
              <a href="#" className="text-gray-500 hover:text-white text-sm transition-colors">Privacy</a>
              <a href="#" className="text-gray-500 hover:text-white text-sm transition-colors">Docs</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
