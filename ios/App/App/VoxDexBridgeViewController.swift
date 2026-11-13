import Capacitor

/// App bridge with the local ASWebAuthenticationSession plugin registered.
/// `SceneDelegate` installs this as the window root. The storyboard still
/// names `CAPBridgeViewController`; this subclass replaces it before the
/// web view loads.
class VoxDexBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AsWebAuthPlugin())
    }
}
