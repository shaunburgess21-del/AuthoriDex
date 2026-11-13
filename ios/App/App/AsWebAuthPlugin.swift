import AuthenticationServices
import Capacitor
import UIKit

/// Google OAuth sheet for the iOS shell. Android stays on Custom Tabs.
/// The session intercepts `com.voxdex.app://login` and returns that URL to JS,
/// which runs the same PKCE exchange as the Android `appUrlOpen` path.
@objc(AsWebAuthPlugin)
public class AsWebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "AsWebAuthPlugin"
    public let jsName = "AsWebAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    private var session: ASWebAuthenticationSession?

    @objc func authenticate(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("A sign-in URL is required.", "invalid_url")
            return
        }
        let scheme = call.getString("callbackScheme") ?? "com.voxdex.app"
        if scheme.isEmpty || scheme.contains(":") || scheme.contains("/") {
            call.reject("The callback scheme must be a URL scheme, not a full URL.", "invalid_scheme")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Authentication session is unavailable.", "unavailable")
                return
            }
            self.start(url: url, scheme: scheme, call: call)
        }
    }

    private func start(url: URL, scheme: String, call: CAPPluginCall) {
        let box = CompletionBox()
        let authSession = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
            DispatchQueue.main.async {
                guard !box.finished else { return }
                box.finished = true
                self?.session = nil
                self?.finish(call, callbackURL: callbackURL, error: error)
            }
        }
        // Shared Safari cookies (the default). A private session would hide
        // Google accounts the user is already signed into.
        authSession.prefersEphemeralWebBrowserSession = false
        authSession.presentationContextProvider = self
        session = authSession

        if !authSession.start() {
            guard !box.finished else { return }
            box.finished = true
            session = nil
            call.reject("Could not start the sign-in sheet.", "start_failed")
        }
    }

    private func finish(_ call: CAPPluginCall, callbackURL: URL?, error: Error?) {
        if let error {
            if isCancellation(error) {
                call.reject("The user cancelled sign-in.", "cancelled")
                return
            }
            call.reject(error.localizedDescription, "auth_error", error)
            return
        }
        guard let callbackURL else {
            call.reject("Google sign-in did not return to the app.", "no_callback")
            return
        }
        call.resolve(["url": callbackURL.absoluteString])
    }

    private func isCancellation(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == ASWebAuthenticationSessionError.errorDomain
            && nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
    }

    public func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window ?? bridge?.webView?.window {
            return window
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            if let window = scene.windows.first(where: { $0.isKeyWindow }) {
                return window
            }
        }
        if let window = scenes.first?.windows.first {
            return window
        }
        return ASPresentationAnchor()
    }
}

private final class CompletionBox {
    var finished = false
}
