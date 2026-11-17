#!/usr/bin/env python3
"""Behavioral checks for answer mapping and untrusted source HTML conversion."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("bank_export", Path(__file__).with_name("export-question-bank.py"))
bank = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bank)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.images = bank.Images(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def row(self, **values):
        return dict(type=1, content="题干", contentHtml="<p>题干</p>", options='["选项一","选项二"]', answer="1", answerIndex=1, analysis="解释", analysisHtml="", difficulty=9) | values

    def test_html_does_not_carry_executable_markup(self):
        value = bank.markdown('<p onclick="evil()">正文<script>evil()</script><iframe>hidden</iframe><a href="javascript:evil()">链接</a><img src="javascript:evil()"></p>', self.images)
        self.assertEqual(value, "正文链接")
        self.assertNotIn("evil", value)
        self.assertEqual(len(self.images.rejected), 1)

    def test_local_images_and_remote_formula_url(self):
        (Path(self.directory.name) / "abc.png").write_bytes(b"image")
        value = bank.markdown('<p><img src="//fb.fbstatic.cn/tarzan/images/abc.png"><img alt="公式]" src="https://fb.fenbike.cn/api/planet/accessories/formulas?latex=(x y)"></p>', self.images)
        self.assertIn("![图片](/api/v1/bank-assets/abc.png)", value)
        self.assertIn("latex=%28x%20y%29)", value)
        self.assertIn("![公式]", value)
        self.assertEqual(self.images.local, {"abc.png"})

    def test_missing_cache_retains_source_image(self):
        value = bank.markdown('<img src="https://fb.fbstatic.cn/tarzan/images/missing.png">', self.images)
        self.assertIn("https://fb.fbstatic.cn/tarzan/images/missing.png", value)
        self.assertEqual(self.images.missing["missing.png"], 1)

    def test_literal_escaped_option_attributes(self):
        (Path(self.directory.name) / "abc.png").write_bytes(b"image")
        value = bank.markdown(r'<p><img src=\"https://fb.fbstatic.cn/tarzan/images/abc.png\"></p>', self.images)
        self.assertIn("/api/v1/bank-assets/abc.png", value)

    def test_table_and_superscripts_keep_their_values(self):
        value = bank.markdown('<table><tr><td>年份</td><td>数量</td></tr><tr><td>2026</td><td>2<sup>3</sup>+H<sub>2</sub>O</td></tr></table>', self.images)
        self.assertIn("年份\t数量", value)
        self.assertIn("2026\t2^(3)+H_(2)O", value)

    def test_zero_based_answers_and_multi_formats(self):
        for answer in ("0,1", "[0,1]", "[[0,1]]"):
            result, reason = bank.normalize_question(self.row(type=3, answer=answer, answerIndex=-1), self.images)
            self.assertEqual(result["type"], "multiple")
            self.assertEqual(result["correctAnswer"], ["A", "B"])
            self.assertIsNone(reason)
        result, _ = bank.normalize_question(self.row(answer=None, answerIndex=0), self.images)
        self.assertEqual(result["correctAnswer"], ["A"])
        result, _ = bank.normalize_question(self.row(answer="0", answerIndex=1), self.images)
        self.assertEqual(result["correctAnswer"], ["B"])

    def test_boolean_options_are_synthesized_without_guessing_answers(self):
        result, _ = bank.normalize_question(self.row(type=5, options="[]", answer="1"), self.images)
        self.assertEqual([option["text"] for option in result["options"]], ["正确", "错误"])
        self.assertEqual(result["correctAnswer"], ["B"])
        unknown, _ = bank.normalize_question(self.row(type=12, options="[]", answer=None, answerIndex=-1, analysis="故表述错误。"), self.images)
        self.assertEqual((unknown["type"], unknown["correctAnswer"]), ("subjective", []))

    def test_bad_objective_data_is_readable_without_fabricated_answer(self):
        result, reason = bank.normalize_question(self.row(answer="7", answerIndex=-1), self.images)
        self.assertEqual((result["type"], result["options"], result["correctAnswer"]), ("subjective", [], []))
        self.assertTrue(result["title"].startswith("题干"))
        self.assertIsNotNone(reason)

    def test_downgrade_preserves_readable_source_options(self):
        result, _ = bank.normalize_question(self.row(options='["候选一", ""]'), self.images)
        self.assertEqual(result["type"], "subjective")
        self.assertIn("A. 候选一", result["title"])
        self.assertIn("B. （源选项内容缺失）", result["title"])
        subjective, _ = bank.normalize_question(self.row(type=61, options='["匹配项一","匹配项二"]', answer=None), self.images)
        self.assertIn("匹配项二", subjective["title"])
        metadata, _ = bank.normalize_question(self.row(type=21, options='[{"intOptionId":430,"optionDesc":null}]', answer=None), self.images)
        self.assertNotIn("intOptionId", metadata["title"])

    def test_stable_ids_preserve_identity_but_not_cross_subject_ids(self):
        self.assertEqual(bank.stable_id("kaogong-shuati:行测:12"), bank.stable_id("kaogong-shuati:行测:12"))
        self.assertNotEqual(bank.stable_id("kaogong-shuati:行测:12"), bank.stable_id("kaogong-shuati:申论:12"))


if __name__ == "__main__":
    unittest.main()
