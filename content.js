// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "PING") {
    sendResponse({ status: "alive" });
    return true;
  }

  if (request.type === "GET_JIRA_DATA") {
    try {
      const issueKey = window.location.pathname.split("/").pop();
      const summary =
        document.querySelector(
          '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
        )?.innerText || "";
      const description =
        document.querySelector(
          '[data-testid="issue.views.field.rich-text.description"]',
        )?.innerText || "";

      sendResponse({ issueKey, summary, description });
    } catch (error) {
      sendResponse({ error: error.message });
    }
    return true;
  }
  // REMOVED: request.type === "CREATE_XRAY_TEST" logic from here
});

/* ===============================
   CREATE XRAY TEST USING EXISTING SESSION
================================= */

async function createXrayTest(scenario, originalIssueKey) {
  console.log("Starting Xray test creation...");
  console.log("Original issue:", originalIssueKey);
  console.log("Scenario:", scenario.substring(0, 100) + "...");

  // Get project key from original issue
  const projectKey = originalIssueKey.split("-")[0];

  // Parse scenario to get test name
  const scenarioLines = scenario.split("\n");
  let testName = "";

  for (const line of scenarioLines) {
    if (line.startsWith("Scenario:")) {
      testName = line.replace("Scenario:", "").trim();
      break;
    }
  }

  if (!testName) {
    testName = `Test for ${originalIssueKey}`;
  }

  // Step 1: Create test issue
  const testIssueKey = await createTestIssue(projectKey, testName, scenario);
  console.log("Test issue created:", testIssueKey);

  // Step 2: Link test to original issue
  await linkTestToOriginal(testIssueKey, originalIssueKey);
  console.log("Linked test to original issue");

  // Step 3: Add Cucumber scenario (if Xray is installed)
  try {
    await addCucumberScenario(testIssueKey, scenario);
    console.log("Cucumber scenario added");
  } catch (error) {
    console.warn("Could not add Cucumber scenario:", error.message);
    // Continue anyway - test was created and linked
  }

  return testIssueKey;
}

/* ===============================
   JIRA API FUNCTIONS USING EXISTING SESSION
================================= */

async function createTestIssue(projectKey, summary, description) {
  console.log("Creating test issue in project:", projectKey);

  const response = await fetch("/rest/api/3/issue", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Atlassian-Token": "no-check", // Required for some Jira versions
    },
    body: JSON.stringify({
      fields: {
        project: {
          key: projectKey,
        },
        summary: summary,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: description,
                },
              ],
            },
          ],
        },
        issuetype: {
          name: "Test", // Adjust based on your Jira setup
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create test: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.key;
}

async function linkTestToOriginal(testIssueKey, originalIssueKey) {
  console.log("Linking", testIssueKey, "to", originalIssueKey);

  // Try different link types
  const linkTypes = ["Tests", "Relates", "is tested by"];

  for (const linkType of linkTypes) {
    try {
      const response = await fetch("/rest/api/3/issueLink", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Atlassian-Token": "no-check",
        },
        body: JSON.stringify({
          type: {
            name: linkType,
          },
          inwardIssue: {
            key: testIssueKey,
          },
          outwardIssue: {
            key: originalIssueKey,
          },
        }),
      });

      if (response.ok || response.status === 400) {
        // 400 often means link already exists
        console.log(`Linked with "${linkType}" relationship`);
        return;
      }
    } catch (error) {
      console.log(`Failed to link with "${linkType}":`, error.message);
    }
  }

  console.warn("Could not create link - may need manual linking");
}

async function addCucumberScenario(testIssueKey, scenarioText) {
  console.log("Adding Cucumber scenario to test issue");

  // This is Xray-specific endpoint - adjust based on your Xray setup
  const response = await fetch("/rest/raven/1.0/import/feature", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-Atlassian-Token": "no-check",
    },
    body: scenarioText,
  });

  if (!response.ok) {
    throw new Error(`Failed to add Cucumber scenario: ${response.status}`);
  }

  return response;
}
