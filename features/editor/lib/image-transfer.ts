/**
 * Reading image files out of a paste or drop.
 *
 * A DataTransfer exposes the same payload two ways and browsers disagree about
 * which one they populate, so both are consulted. Nothing here touches the
 * editor: it turns a transfer into files and stops.
 */
export function imageFilesFromDataTransfer(dataTransfer: DataTransfer): File[] {
    const files = imageFilesFromList(dataTransfer.files);
    if (files.length > 0) {
        return files;
    }

    return Array.from(dataTransfer.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
}

export function dataTransferHasImage(dataTransfer: DataTransfer): boolean {
    return (
        imageFilesFromList(dataTransfer.files).length > 0 ||
        Array.from(dataTransfer.items).some(
            (item) => item.kind === "file" && item.type.startsWith("image/"),
        )
    );
}

function imageFilesFromList(files: FileList) {
    return Array.from(files).filter((file) => file.type.startsWith("image/"));
}
