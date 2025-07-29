import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, Key, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { APIConfig, UserSettings } from '@/types';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { apiService } from '@/lib/apiService';

interface SettingsPageProps {
  onBack: () => void;
}

export default function SettingsPage({ onBack }: SettingsPageProps) {
  const [apiConfig, setApiConfig] = useState<Partial<APIConfig>>({
    anthropicApiKey: '',
    googleServiceAccount: '',
  });
  const [userSettings, setUserSettings] = useState<UserSettings>({
    preferredLanguage: 'hindi',
    speechRate: 0.85,
    voiceType: 'hi-IN-Wavenet-A',
    offlineMode: false,
  });
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load saved settings
  useEffect(() => {
    const savedApiConfig = storage.getItem<APIConfig>(STORAGE_KEYS.API_CONFIG);
    if (savedApiConfig) {
      setApiConfig(savedApiConfig);
    }

    const savedUserSettings = storage.getItem<UserSettings>(STORAGE_KEYS.USER_SETTINGS);
    if (savedUserSettings) {
      setUserSettings(savedUserSettings);
    }

    // Test connection on load if API keys exist
    if (savedApiConfig?.anthropicApiKey && savedApiConfig?.googleServiceAccount) {
      testConnection();
    }
  }, []);

  const testConnection = async () => {
    setTesting(true);
    setError(null);

    try {
      const result = await apiService.testConnection();
      if (result.success) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('error');
        setError(result.error || 'Connection test failed');
      }
    } catch (err) {
      setConnectionStatus('error');
      setError(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSaveApiConfig = async () => {
    if (!apiConfig.anthropicApiKey || !apiConfig.googleServiceAccount) {
      setError('Please fill in all required API fields');
      return;
    }

    try {
      // Validate Google Service Account JSON
      JSON.parse(apiConfig.googleServiceAccount);
    } catch {
      setError('Invalid Google Service Account JSON format');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Save API configuration
      storage.setItem(STORAGE_KEYS.API_CONFIG, apiConfig as APIConfig);
      
      // Test connection
      await testConnection();
      
      setSuccess('API configuration saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUserSettings = () => {
    storage.setItem(STORAGE_KEYS.USER_SETTINGS, userSettings);
    setSuccess('Settings saved successfully');
    setTimeout(() => setSuccess(null), 3000);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Status Bar Simulator */}
      <div className="h-11 bg-white flex items-center justify-between px-4 text-sm font-medium text-gray-900">
        <span>9:41</span>
        <div className="flex items-center gap-1 text-xs">
          <div className="w-4 h-2 border border-gray-400 rounded-sm">
            <div className="w-3/4 h-full bg-gray-900 rounded-sm"></div>
          </div>
        </div>
      </div>

      {/* Settings Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center">
        <Button variant="ghost" size="sm" onClick={onBack} className="mr-2">
          <ArrowLeft className="text-gray-600" size={16} />
        </Button>
        <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
      </header>

      <div className="p-4 space-y-6 pb-24">
        {/* Success/Error Messages */}
        {success && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">{success}</AlertDescription>
          </Alert>
        )}
        
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* API Configuration Section */}
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="text-yellow-600" size={20} />
              API Configuration
              <span className="px-2 py-1 bg-yellow-200 text-yellow-800 text-xs font-medium rounded-full">
                Required
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Anthropic API Key */}
            <div className="space-y-2">
              <Label htmlFor="anthropic-key">
                1. Anthropic API Key (Claude AI) *
              </Label>
              <Input
                id="anthropic-key"
                type="password"
                placeholder="sk-ant-api03-..."
                value={apiConfig.anthropicApiKey}
                onChange={(e) => setApiConfig(prev => ({ ...prev, anthropicApiKey: e.target.value }))}
              />
              <p className="text-xs text-gray-500">
                Get your API key from{' '}
                <a 
                  href="https://console.anthropic.com/" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-blue-600 hover:underline"
                >
                  Anthropic Console
                </a>
              </p>
            </div>

            {/* Google Cloud Service Account */}
            <div className="space-y-2">
              <Label htmlFor="google-json">
                2. Google Cloud Service Account JSON *
              </Label>
              <Textarea
                id="google-json"
                placeholder="Paste your Google Cloud service account JSON here..."
                rows={4}
                className="text-xs font-mono"
                value={apiConfig.googleServiceAccount}
                onChange={(e) => setApiConfig(prev => ({ ...prev, googleServiceAccount: e.target.value }))}
              />
              <p className="text-xs text-gray-500">
                Download from{' '}
                <a 
                  href="https://console.cloud.google.com/" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-blue-600 hover:underline"
                >
                  Google Cloud Console
                </a>
                {' '}→ IAM & Admin → Service Accounts
              </p>
            </div>

            {/* API Status */}
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <div className={`w-3 h-3 rounded-full ${
                connectionStatus === 'connected' ? 'bg-green-500' : 
                connectionStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'
              }`} />
              <span className="text-sm text-gray-700">
                API Status: {
                  connectionStatus === 'connected' ? 'Connected' :
                  connectionStatus === 'error' ? 'Not Connected' : 'Unknown'
                }
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={testConnection}
                disabled={testing}
              >
                {testing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>
            </div>

            <Button 
              onClick={handleSaveApiConfig}
              disabled={saving || !apiConfig.anthropicApiKey || !apiConfig.googleServiceAccount}
              className="w-full"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save API Configuration'
              )}
            </Button>
          </CardContent>
        </Card>

        {/* App Settings */}
        <Card>
          <CardHeader>
            <CardTitle>App Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Language Preference */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">Preferred Language</h3>
                <p className="text-sm text-gray-500">Choose your default language</p>
              </div>
              <Select
                value={userSettings.preferredLanguage}
                onValueChange={(value: 'hindi' | 'english' | 'hinglish') => 
                  setUserSettings(prev => ({ ...prev, preferredLanguage: value }))
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hindi">Hindi</SelectItem>
                  <SelectItem value="english">English</SelectItem>
                  <SelectItem value="hinglish">Hinglish</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Voice Settings */}
            <div className="space-y-4">
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Voice Settings</h3>
                <p className="text-sm text-gray-500 mb-4">Adjust speech rate and voice</p>
              </div>
              
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">
                    Speech Rate: {userSettings.speechRate}x
                  </Label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={userSettings.speechRate}
                    onChange={(e) => setUserSettings(prev => ({ 
                      ...prev, 
                      speechRate: parseFloat(e.target.value) 
                    }))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Slow</span>
                    <span>Fast</span>
                  </div>
                </div>
                
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">Voice Type</Label>
                  <Select
                    value={userSettings.voiceType}
                    onValueChange={(value) => setUserSettings(prev => ({ ...prev, voiceType: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hi-IN-Wavenet-A">Hindi Female (Wavenet-A)</SelectItem>
                      <SelectItem value="hi-IN-Wavenet-B">Hindi Male (Wavenet-B)</SelectItem>
                      <SelectItem value="en-US-Wavenet-C">English Female (Wavenet-C)</SelectItem>
                      <SelectItem value="en-US-Wavenet-D">English Male (Wavenet-D)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Offline Mode */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">Offline Mode</h3>
                <p className="text-sm text-gray-500">Cache responses for offline use</p>
              </div>
              <Switch
                checked={userSettings.offlineMode}
                onCheckedChange={(checked) => setUserSettings(prev => ({ ...prev, offlineMode: checked }))}
              />
            </div>

            <Button onClick={handleSaveUserSettings} className="w-full">
              Save Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
