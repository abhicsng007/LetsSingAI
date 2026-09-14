"""Diagnostic: verify AWS credentials + Bedrock model access so the vocal-coach
agent runs on Bedrock instead of the offline heuristic.

Run from the agent folder:
    .venv\\Scripts\\python check_bedrock.py      (Windows)
    .venv/bin/python check_bedrock.py            (macOS/Linux)

It reads agent/.env (same as the server), then makes one tiny Bedrock call and
tells you exactly what to fix if it fails.
"""

from __future__ import annotations

import os

import envload  # noqa: F401 — load agent/.env
import agent

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

MODEL_ID = os.getenv("BEDROCK_MODEL_ID", agent.DEFAULT_MODEL_ID)
REGION = os.getenv("AWS_REGION", "us-west-2")


def main() -> int:
    print("LetsSingAI - Bedrock connectivity check")
    print("-" * 44)
    print(f"Region   : {REGION}")
    print(f"Model ID : {MODEL_ID}")

    session = boto3.Session(region_name=REGION)
    creds = session.get_credentials()
    if not creds or not creds.access_key:
        print("\n[X] No AWS credentials found.")
        print("    Add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to agent/.env")
        print("    (copy agent/.env.example to agent/.env and fill it in).")
        return 1
    print(f"Creds    : found (access key ...{creds.access_key[-4:]})")

    try:
        client = session.client("bedrock-runtime")
        resp = client.converse(
            modelId=MODEL_ID,
            messages=[{"role": "user", "content": [{"text": "Reply with the single word: ok"}]}],
            inferenceConfig={"maxTokens": 5, "temperature": 0},
        )
        text = resp["output"]["message"]["content"][0]["text"].strip()
        print(f"\n[OK] Bedrock responded: {text!r}")
        print("Your agent will run on Bedrock. Start the server and sing a take —")
        print("the coach badge should read 'Strands · Bedrock'.")
        return 0
    except NoCredentialsError:
        print("\n[X] Credentials were rejected as invalid. Re-check the two keys in agent/.env.")
        return 1
    except ClientError as exc:
        err = exc.response.get("Error", {})
        code = err.get("Code", "")
        message = err.get("Message", str(exc))
        low = message.lower()
        print(f"\n[X] Bedrock call failed: {code}")
        print(f"    {message}")
        if "verif" in low or "being verified" in low:
            print("    This is a NEW-ACCOUNT hold, not a setup problem — your keys,")
            print("    region, and model are all correct. AWS is still activating the")
            print("    account. Usually clears in < 2 hours (up to ~24h). Meanwhile:")
            print("      - make sure a valid payment method is on file (Billing console),")
            print("        as verification often stalls without one;")
            print("      - then just re-run this script until it says [OK].")
            print("    The app works in offline-heuristic mode until then.")
        elif code in ("AccessDeniedException", "AccessDenied") and (
            "use case" in low or "usage" in low or "entitlement" in low or "form" in low
        ):
            print("    Fix: submit the one-time Anthropic usage form (Bedrock console >")
            print("         Playground > pick a Claude model > fill the form). Or switch")
            print("         BEDROCK_MODEL_ID to an Amazon Nova model, which needs no form.")
        elif code in ("AccessDeniedException", "AccessDenied"):
            print("    Fix: your IAM user lacks Bedrock permission. Attach")
            print("         'AmazonBedrockFullAccess' (or a policy allowing bedrock:InvokeModel).")
        elif code in ("ValidationException", "ResourceNotFoundException"):
            print("    Fix: this model id isn't valid/enabled for this region. Set")
            print("         BEDROCK_MODEL_ID in agent/.env to a model shown as enabled")
            print("         in the console's Model access list (keep the 'us.' prefix for")
            print("         inference-profile models).")
        elif code in ("UnrecognizedClientException",):
            print("    Fix: the access key is wrong or from a different account.")
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"\n[X] Unexpected error: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
