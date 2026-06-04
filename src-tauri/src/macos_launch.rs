use std::sync::{Mutex, OnceLock};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSApplicationDidFinishLaunchingNotification, NSApplicationLaunchIsDefaultLaunchKey,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSNumber, NSOperationQueue};
static DEFAULT_LAUNCH: OnceLock<Mutex<Option<bool>>> = OnceLock::new();

pub fn install_launch_observer() {
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
            let mut observed = observed_default_launch().lock().unwrap();
            *observed = Some(default_launch);
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

pub fn observed_launch_reason() -> Option<bool> {
    *observed_default_launch().lock().unwrap()
}

fn observed_default_launch() -> &'static Mutex<Option<bool>> {
    DEFAULT_LAUNCH.get_or_init(|| Mutex::new(None))
}
