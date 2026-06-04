use std::sync::Mutex;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSApplicationDidFinishLaunchingNotification, NSApplicationLaunchIsDefaultLaunchKey,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSNumber, NSOperationQueue};
use tauri::{AppHandle, Manager};

use crate::window_sessions::StartupOpenRoutingState;

pub fn observe_launch_reason(app: AppHandle) {
    let center = NSNotificationCenter::defaultCenter();
    let block = RcBlock::new(move |notification: std::ptr::NonNull<NSNotification>| {
        let default_launch = unsafe {
            notification
                .as_ref()
                .userInfo()
                .and_then(|user_info| {
                    user_info
                        .cast_unchecked::<objc2_foundation::NSString, AnyObject>()
                        .objectForKey(NSApplicationLaunchIsDefaultLaunchKey)
                })
                .map(|value| Retained::cast_unchecked::<NSNumber>(value).boolValue())
        };

        if let Some(default_launch) = default_launch {
            let state = app.state::<Mutex<StartupOpenRoutingState>>();
            let mut startup = state.lock().unwrap();
            startup.observe_default_launch(default_launch);
        }
    });

    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidFinishLaunchingNotification),
            None,
            Option::<&NSOperationQueue>::None,
            &block,
        )
    };

    // Keep the observer token alive for the app process lifetime; Tauri state
    // requires Send + Sync, while Cocoa observer tokens are main-thread objects.
    std::mem::forget(observer);
}
