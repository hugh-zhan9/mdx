import { describe, expect, it } from "vitest";

import { documentStats } from "./document-stats";

describe("documentStats", () => {
    it("counts Latin words by their runs", () => {
        expect(documentStats("Hello world")).toEqual({
            words: 2,
            characters: 10,
            minutes: 1,
        });
    });

    it("counts a CJK character as a word, because there is no space to count", () => {
        expect(documentStats("今天吃什么")).toEqual({
            words: 5,
            characters: 5,
            minutes: 1,
        });
    });

    it("keeps a Latin word inside a CJK sentence from merging with it", () => {
        expect(documentStats("今天用 Claude 写代码").words).toBe(7);
    });

    it("drops fenced code, which is not prose", () => {
        const markdown = [
            "测试",
            "",
            "```python",
            "def main():",
            '    print("hello world")',
            "```",
            "",
        ].join("\n");

        expect(documentStats(markdown)).toEqual({
            words: 2,
            characters: 2,
            minutes: 1,
        });
    });

    it("drops a fence that is still being typed", () => {
        expect(documentStats("测试\n\n```python\ndef main():").words).toBe(2);
    });

    it("drops front matter", () => {
        const markdown = [
            "---",
            "title: Two Sum",
            "tags: [leetcode, rust]",
            "---",
            "",
            "# Two Sum",
            "",
        ].join("\n");

        expect(documentStats(markdown)).toEqual({
            words: 2,
            characters: 6,
            minutes: 1,
        });
    });

    it("counts what markup wraps, not the markup", () => {
        expect(documentStats("**bold** and _italic_ and `code`").words).toBe(5);
        expect(documentStats("> 引用").words).toBe(2);
        expect(documentStats("- [x] 读题").words).toBe(2);
        expect(documentStats("| 名字 | 值 |\n| --- | --- |").words).toBe(3);
    });

    it("keeps what a link says and drops where it points", () => {
        expect(documentStats("[百度](https://baidu.com)")).toEqual({
            words: 2,
            characters: 2,
            minutes: 1,
        });
        expect(documentStats("[[目标笔记|读题]]").words).toBe(2);
    });

    it("reads no prose in an image", () => {
        expect(documentStats("![屏幕截图](docs/assets/logo.svg)")).toEqual({
            words: 0,
            characters: 0,
            minutes: 0,
        });
    });

    it("gives an empty document no reading time at all", () => {
        expect(documentStats("")).toEqual({
            words: 0,
            characters: 0,
            minutes: 0,
        });
        expect(documentStats("\n\n   \n").minutes).toBe(0);
    });

    it("rounds reading time to whole minutes, and never below one", () => {
        expect(documentStats("word ".repeat(45)).minutes).toBe(1);
        expect(documentStats("word ".repeat(450)).minutes).toBe(2);
        expect(documentStats("word ".repeat(900)).minutes).toBe(3);
    });
});
